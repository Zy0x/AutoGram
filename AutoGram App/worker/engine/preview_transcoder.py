import os
import asyncio
import subprocess
from typing import Dict, Any, Optional
from engine.media_meta import _ffmpeg_exe, probe_with_ffmpeg, probe_encoder_capabilities

class SmartPreviewTranscoder:
    def __init__(self, max_height: int = 720):
        self.max_height = max_height

    async def transcode_preview_segment(
        self, 
        input_path: str, 
        output_path: str,
        duration: int = 30,
        start_at: float = 0.0
    ) -> str:
        exe = _ffmpeg_exe()
        if not exe:
            raise RuntimeError("ffmpeg not found")
            
        caps = probe_encoder_capabilities()
        
        # Determine best hardware accelerated encoder
        hwaccel = None
        encoder = 'libx264'
        preset = 'ultrafast'
        extra_args = ['-crf', '24']
        
        if caps.get('nvidia', {}).get('usable'):
            hwaccel = 'cuda'
            encoder = 'h264_nvenc'
            preset = 'p4'
            extra_args = []
        elif caps.get('intel', {}).get('usable'):
            hwaccel = 'qsv'
            encoder = 'h264_qsv'
            preset = 'veryfast'
            extra_args = []
        elif caps.get('amd', {}).get('usable'):
            hwaccel = 'd3d11va'
            encoder = 'h264_amf'
            preset = 'balanced'
            extra_args = []
            
        cmd = [
            exe, '-y', '-hide_banner',
        ]
        if hwaccel:
            cmd.extend(['-hwaccel', hwaccel])
            
        cmd.extend([
            '-ss', str(start_at),
            '-i', input_path,
            '-t', str(duration),
            '-c:v', encoder,
            '-preset', preset,
        ])
        
        if encoder == 'h264_nvenc':
            cmd.extend(['-vf', f'scale=-2:{self.max_height}:flags=fast_bilinear'])
        elif encoder == 'h264_qsv':
            cmd.extend(['-vf', f'vpp_qsv=w=-2:h={self.max_height}'])
        else:
            cmd.extend(['-vf', f'scale=-2:{self.max_height}'])
            
        cmd.extend([
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            '-f', 'mp4',
            output_path
        ])
        if extra_args:
            cmd.extend(extra_args)
            
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        proc = await asyncio.create_subprocess_exec(*cmd, creationflags=creationflags)
        await proc.wait()
        
        if proc.returncode != 0 and encoder != 'libx264':
            # Fallback to software encoder
            cmd = [
                exe, '-y', '-hide_banner',
                '-ss', str(start_at),
                '-i', input_path,
                '-t', str(duration),
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-vf', f'scale=-2:{self.max_height}',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-movflags', '+faststart',
                '-f', 'mp4',
                '-crf', '24',
                output_path
            ]
            proc = await asyncio.create_subprocess_exec(*cmd, creationflags=creationflags)
            await proc.wait()
            
        return output_path
