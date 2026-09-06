#!/usr/bin/env python3
"""Build a dialogue-only lookup dictionary from an unencrypted Unreal v3 PAK.

No game binaries are executed or extracted. Only the selected English-slot
Dialogues_All.locres is read; it contains Russian values and English CRC32s.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct


class Reader:
    def __init__(self, data, position=0):
        self.data = data
        self.position = position

    def take(self, length):
        if length < 0 or self.position + length > len(self.data):
            raise ValueError('Truncated input')
        value = self.data[self.position:self.position + length]
        self.position += length
        return value

    def number(self, fmt):
        return struct.unpack('<' + fmt, self.take(struct.calcsize('<' + fmt)))[0]

    def string(self):
        length = self.number('i')
        if abs(length) > 1_000_000:
            raise ValueError('Oversized string')
        if not length:
            return ''
        raw = self.take(abs(length) * (2 if length < 0 else 1))
        terminator = b'\0\0' if length < 0 else b'\0'
        if not raw.endswith(terminator):
            raise ValueError('Unterminated string')
        return raw[:-len(terminator)].decode('utf-16-le' if length < 0 else 'utf-8')

    def count(self):
        value = self.number('I')
        if value > 1_000_000:
            raise ValueError('Oversized table')
        return value


def read_dialogues(pak):
    footer = Reader(pak, len(pak) - 44)
    if footer.number('I') != 0x5A6F12E1 or footer.number('I') != 3:
        raise ValueError('Only unencrypted v3 PAK files are supported')
    offset, size = footer.number('Q'), footer.number('Q')
    expected_hash = footer.take(20)
    index_bytes = Reader(pak, offset).take(size)
    if hashlib.sha1(index_bytes).digest() != expected_hash:
        raise ValueError('PAK index checksum mismatch')
    index = Reader(index_bytes)
    index.string()  # Mount point, never used as a filesystem path.
    found = None
    for _ in range(index.count()):
        name = index.string()
        start = index.position
        entry_offset = index.number('Q')
        compressed_size, raw_size = index.number('Q'), index.number('Q')
        method = index.number('I')
        digest = index.take(20)
        if method:
            for _ in range(index.count()):
                index.take(16)
        flags = index.number('B')
        index.number('I')
        header_size = index.position - start
        if name == 'Dawnwalker/Content/Localization/Dialogues_All/en/Dialogues_All.locres':
            if method or flags or compressed_size != raw_size or found is not None:
                raise ValueError('Unsupported dialogue entry')
            found = Reader(pak, entry_offset + header_size).take(raw_size)
            if hashlib.sha1(found).digest() != digest:
                raise ValueError('Dialogue checksum mismatch')
    if found is None:
        raise ValueError('Dialogues_All English-slot localization not found')
    return found


def read_locres(data):
    reader = Reader(data)
    if reader.take(16).hex() != '0e147475674a03fc4a15909dc3377f1b' or reader.number('B') != 3:
        raise ValueError('Only locres version 3 is supported')
    pool_offset = reader.number('q')
    total, namespaces = reader.count(), reader.count()
    pool_reader = Reader(data, pool_offset)
    pool = []
    for _ in range(pool_reader.count()):
        pool.append(pool_reader.string())
        pool_reader.number('i')
    rows = []
    for _ in range(namespaces):
        reader.number('I')
        reader.string()
        for _ in range(reader.count()):
            reader.number('I')
            reader.string()
            source_hash, text_index = reader.number('I'), reader.number('i')
            if not 0 <= text_index < len(pool):
                raise ValueError('Invalid localized string index')
            rows.append((source_hash, pool[text_index].strip()))
    if len(rows) != total or reader.position != pool_offset or pool_reader.position != len(data):
        raise ValueError('Invalid localization table boundaries')
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pak', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    pak = args.pak.read_bytes()
    rows = read_locres(read_dialogues(pak))
    grouped = {}
    for source_hash, text in rows:
        grouped.setdefault(source_hash, set()).add(text)
    strings, string_ids, entries = [], {}, []
    ambiguous = sum(len(values) != 1 for values in grouped.values())
    for source_hash, values in sorted(grouped.items()):
        if len(values) != 1:
            continue
        text = next(iter(values))
        if not re.search('[А-Яа-яЁё]', text):
            continue
        if text not in string_ids:
            string_ids[text] = len(strings)
            strings.append(text)
        entries.append([source_hash, string_ids[text]])
    payload = {
        'schema': 1,
        'id': 'dawnwalker-clarkkent',
        'game': 'The Blood of Dawnwalker',
        'sourceLanguage': 'en',
        'targetLanguage': 'ru',
        'author': 'clarkkent',
        'authorUrl': 'https://boosty.to/clarkkent',
        'sourceVersion': '1.0.7 (version reported in the supplied README)',
        'sourcePakSha256': hashlib.sha256(pak).hexdigest(),
        'stats': {'sourceDialogueEntries': len(rows), 'ambiguousHashesExcluded': ambiguous},
        'strings': strings,
        'entries': entries,
    }
    encoded = (json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    digest = hashlib.sha256(encoded).hexdigest()
    args.output.mkdir(parents=True, exist_ok=True)
    destination = args.output / f'dawnwalker-clarkkent-{digest[:12]}.json'
    destination.write_bytes(encoded)
    print(json.dumps({'file': str(destination), 'sha256': digest, 'bytes': len(encoded), 'hashes': len(entries), 'strings': len(strings), **payload['stats']}, indent=2))


if __name__ == '__main__':
    main()
