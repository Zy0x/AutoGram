import subprocess
import os
import shutil

class Preprocessor:
    def __init__(self):
        self.has_ffmpeg = shutil.which("ffmpeg") is not None
        
    def preprocess(self, input_path: str, quality_mode: str) -> str:
        """
        Preprocess the file based on the quality mode.
        Returns the path to the preprocessed file, or the original if no processing.
        """
        if quality_mode != 'HIGH_QUALITY':
            return input_path
            
        if not self.has_ffmpeg:
            return input_path
            
        ext = os.path.splitext(input_path)[1].lower()
        
        # We only preprocess videos in this basic implementation
        if ext in ['.mp4', '.mov', '.mkv', '.avi']:
            output_path = f"{input_path}_hq.mp4"
            # Fast transcode to standard h264 for Telegram native playability
            cmd = [
                "ffmpeg", "-y", "-i", input_path,
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k",
                "-max_muxing_queue_size", "1024",
                output_path
            ]
            try:
                subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if os.path.exists(output_path):
                    return output_path
            except Exception as e:
                print(f"FFmpeg preprocessing failed: {e}")
                
        return input_path
