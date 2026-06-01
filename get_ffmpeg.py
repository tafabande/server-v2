import os
import sys
import shutil
import zipfile
import tempfile
import urllib.request
from pathlib import Path

FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
BASE_DIR = Path(__file__).resolve().parent
BIN_DIR = BASE_DIR / "bin"

def download_ffmpeg():
    print(f"Downloading FFmpeg release essentials from {FFMPEG_URL}...")
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    
    # We will download the zip to a temporary file
    req = urllib.request.Request(
        FFMPEG_URL,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
    )
    
    with tempfile.TemporaryDirectory() as tmpdir:
        zip_path = Path(tmpdir) / "ffmpeg.zip"
        
        # Download with progress indication
        try:
            with urllib.request.urlopen(req) as response, open(zip_path, "wb") as out_file:
                content_length = response.getheader('content-length')
                total_size = int(content_length) if content_length else None
                bytes_downloaded = 0
                
                block_size = 1024 * 1024  # 1MB blocks
                while True:
                    buffer = response.read(block_size)
                    if not buffer:
                        break
                    out_file.write(buffer)
                    bytes_downloaded += len(buffer)
                    if total_size:
                        percent = (bytes_downloaded / total_size) * 100
                        sys.stdout.write(f"\rDownloading: {percent:.1f}% ({bytes_downloaded / (1024*1024):.1f}MB / {total_size / (1024*1024):.1f}MB)")
                        sys.stdout.flush()
                    else:
                        sys.stdout.write(f"\rDownloading: {bytes_downloaded / (1024*1024):.1f}MB downloaded")
                        sys.stdout.flush()
            print("\nDownload complete.")
        except Exception as e:
            print(f"\nError downloading FFmpeg: {e}")
            sys.exit(1)
            
        print("Extracting archive...")
        extract_dir = Path(tmpdir) / "extracted"
        try:
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(extract_dir)
            print("Extraction complete.")
        except Exception as e:
            print(f"Error extracting zip archive: {e}")
            sys.exit(1)
            
        # Search for ffmpeg.exe and ffprobe.exe in the extracted directories
        ffmpeg_exe = None
        ffprobe_exe = None
        for root, dirs, files in os.walk(extract_dir):
            for file in files:
                if file.lower() == "ffmpeg.exe":
                    ffmpeg_exe = Path(root) / file
                elif file.lower() == "ffprobe.exe":
                    ffprobe_exe = Path(root) / file
                    
        if not ffmpeg_exe or not ffprobe_exe:
            print("Error: Could not find ffmpeg.exe or ffprobe.exe in the extracted files.")
            sys.exit(1)
            
        # Copy to bin directory
        print("Installing binaries to project bin directory...")
        shutil.copy2(ffmpeg_exe, BIN_DIR / "ffmpeg.exe")
        shutil.copy2(ffprobe_exe, BIN_DIR / "ffprobe.exe")
        print(f"Success! FFmpeg and FFprobe installed to: {BIN_DIR}")

if __name__ == "__main__":
    download_ffmpeg()
