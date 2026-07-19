import struct
from typing import List, Tuple, Dict, Any, Optional

def parse_mp4_keyframes(moov_data: bytes) -> List[Tuple[int, int]]:
    """
    Parse moov atom to extract keyframe index.
    Returns list of tuples: (timestamp_ms, byte_offset)
    """
    try:
        return _parse_moov(moov_data)
    except Exception:
        return []

def _parse_moov(moov_data: bytes) -> List[Tuple[int, int]]:
    # A box helper
    def read_boxes(data: bytes, start: int, end: int) -> Dict[str, bytes]:
        boxes = {}
        offset = start
        while offset < end:
            if offset + 8 > len(data):
                break
            size = struct.unpack(">I", data[offset:offset+4])[0]
            box_type = data[offset+4:offset+8].decode('ascii', errors='ignore')
            if size == 0:
                size = len(data) - offset
            elif size == 1:
                if offset + 16 > len(data):
                    break
                size = struct.unpack(">Q", data[offset+8:offset+16])[0]
                box_offset = offset + 16
                box_size = size - 16
            else:
                box_offset = offset + 8
                box_size = size - 8
            
            # Save box content
            boxes[box_type] = data[box_offset : box_offset + box_size]
            offset += size
        return boxes

    # Find track
    # We might have multiple tracks, we want the video track
    offset = 0
    trak_datas = []
    while offset < len(moov_data):
        if offset + 8 > len(moov_data):
            break
        size = struct.unpack(">I", moov_data[offset:offset+4])[0]
        box_type = moov_data[offset+4:offset+8].decode('ascii', errors='ignore')
        if size == 0:
            size = len(moov_data) - offset
        elif size == 1:
            if offset + 16 > len(moov_data):
                break
            size = struct.unpack(">Q", moov_data[offset+8:offset+16])[0]
        
        if box_type == 'trak':
            trak_datas.append(moov_data[offset:offset+size])
        offset += size

    for trak_data in trak_datas:
        # Read trak children
        trak_boxes = read_boxes(trak_data, 8, len(trak_data))
        if 'mdia' not in trak_boxes:
            continue
        mdia_data = trak_boxes['mdia']
        mdia_boxes = read_boxes(mdia_data, 0, len(mdia_data))
        if 'hdlr' not in mdia_boxes:
            continue
        hdlr_data = mdia_boxes['hdlr']
        if len(hdlr_data) >= 12:
            handler_type = hdlr_data[8:12].decode('ascii', errors='ignore')
            if handler_type != 'vide':
                continue # Skip audio track
        
        # Video track, parse timescale from mdhd
        if 'mdhd' not in mdia_boxes:
            continue
        mdhd_data = mdia_boxes['mdhd']
        version = mdhd_data[0]
        if version == 1:
            timescale = struct.unpack(">I", mdhd_data[20:24])[0]
        else:
            timescale = struct.unpack(">I", mdhd_data[12:16])[0]

        if 'minf' not in mdia_boxes:
            continue
        minf_data = mdia_boxes['minf']
        minf_boxes = read_boxes(minf_data, 0, len(minf_data))
        if 'stbl' not in minf_boxes:
            continue
        stbl_data = minf_boxes['stbl']
        stbl_boxes = read_boxes(stbl_data, 0, len(stbl_data))

        # Parse tables
        if 'stts' not in stbl_boxes or 'stsz' not in stbl_boxes or 'stsc' not in stbl_boxes:
            continue
        
        stss_data = stbl_boxes.get('stss')
        
        # 1. Parse stsz (Sample sizes)
        stsz_data = stbl_boxes['stsz']
        sample_size = struct.unpack(">I", stsz_data[4:8])[0]
        sample_count = struct.unpack(">I", stsz_data[8:12])[0]
        
        sizes = []
        if sample_size == 0:
            for i in range(sample_count):
                idx = 12 + i * 4
                if idx + 4 > len(stsz_data):
                    break
                sizes.append(struct.unpack(">I", stsz_data[idx:idx+4])[0])
        else:
            sizes = [sample_size] * sample_count

        # 2. Parse stco / co64 (Chunk offsets)
        chunk_offsets = []
        if 'stco' in stbl_boxes:
            stco_data = stbl_boxes['stco']
            count = struct.unpack(">I", stco_data[4:8])[0]
            for i in range(count):
                idx = 8 + i * 4
                if idx + 4 > len(stco_data):
                    break
                chunk_offsets.append(struct.unpack(">I", stco_data[idx:idx+4])[0])
        elif 'co64' in stbl_boxes:
            co64_data = stbl_boxes['co64']
            count = struct.unpack(">I", co64_data[4:8])[0]
            for i in range(count):
                idx = 8 + i * 8
                if idx + 8 > len(co64_data):
                    break
                chunk_offsets.append(struct.unpack(">Q", co64_data[idx:idx+8])[0])
        else:
            continue

        # 3. Parse stsc (Sample to chunk)
        stsc_data = stbl_boxes['stsc']
        stsc_count = struct.unpack(">I", stsc_data[4:8])[0]
        stsc_entries = []
        for i in range(stsc_count):
            idx = 8 + i * 12
            if idx + 12 > len(stsc_data):
                break
            first_chunk = struct.unpack(">I", stsc_data[idx:idx+4])[0]
            samples_per_chunk = struct.unpack(">I", stsc_data[idx+4:idx+8])[0]
            sample_desc_idx = struct.unpack(">I", stsc_data[idx+8:idx+12])[0]
            stsc_entries.append((first_chunk, samples_per_chunk, sample_desc_idx))

        # 4. Parse stts (Time to sample)
        stts_data = stbl_boxes['stts']
        stts_count = struct.unpack(">I", stts_data[4:8])[0]
        stts_entries = []
        for i in range(stts_count):
            idx = 8 + i * 8
            if idx + 8 > len(stts_data):
                break
            count = struct.unpack(">I", stts_data[idx:idx+4])[0]
            delta = struct.unpack(">I", stts_data[idx+4:idx+8])[0]
            stts_entries.append((count, delta))

        # Expand sample times & offsets
        sample_to_chunk_offset = {}
        sample_timestamps = {}
        
        # Calculate sample timestamps
        cur_sample = 1
        cur_time = 0
        for count, delta in stts_entries:
            for _ in range(count):
                sample_timestamps[cur_sample] = int(cur_time * 1000 / timescale)
                cur_time += delta
                cur_sample += 1

        # Calculate sample offsets
        cur_sample = 1
        for stsc_idx in range(len(stsc_entries)):
            first_chunk, samples_per_chunk, _ = stsc_entries[stsc_idx]
            next_first_chunk = stsc_entries[stsc_idx+1][0] if stsc_idx + 1 < len(stsc_entries) else len(chunk_offsets) + 1
            for c in range(first_chunk, next_first_chunk):
                if c - 1 >= len(chunk_offsets):
                    break
                chunk_off = chunk_offsets[c - 1]
                for s in range(samples_per_chunk):
                    sample_to_chunk_offset[cur_sample] = chunk_off
                    if cur_sample - 1 < len(sizes):
                        chunk_off += sizes[cur_sample - 1]
                    cur_sample += 1

        # Keyframes list
        keyframe_samples = []
        if stss_data:
            stss_count = struct.unpack(">I", stss_data[4:8])[0]
            for i in range(stss_count):
                idx = 8 + i * 4
                if idx + 4 > len(stss_data):
                    break
                keyframe_samples.append(struct.unpack(">I", stss_data[idx:idx+4])[0])
        else:
            keyframe_samples = list(range(1, sample_count + 1))

        keyframes = []
        for s in keyframe_samples:
            ts = sample_timestamps.get(s, 0)
            off = sample_to_chunk_offset.get(s, 0)
            if off > 0:
                keyframes.append((ts, off))
        
        return keyframes
    return []
