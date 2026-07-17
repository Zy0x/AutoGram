import subprocess
import time
import imageio_ffmpeg

def test_ffmpeg():
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    
    # create a dummy video
    subprocess.run([exe, "-y", "-f", "lavfi", "-i", "testsrc=duration=5:size=640x480:rate=30", "-c:v", "libx264", "test_out.mp4"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    # reencode and read progress
    p = subprocess.Popen(
        [exe, "-y", "-i", "test_out.mp4", "-c:v", "libx264", "test_out2.mp4"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    
    start = time.time()
    cur_line = bytearray()
    while True:
        char = p.stderr.read(1)
        if not char and p.poll() is not None:
            break
        if char:
            cur_line.extend(char)
            if char in (b'\r', b'\n'):
                line = cur_line.decode('utf-8', 'replace')
                cur_line.clear()
                if "time=" in line:
                    print(f"[{time.time() - start:.2f}s] got line: {repr(line)}")

test_ffmpeg()
