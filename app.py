import os
import uuid
import shutil
import subprocess
from flask import Flask, render_template, request, jsonify, send_file, flash
from werkzeug.utils import secure_filename
import tempfile
from pathlib import Path
import json
import time

app = Flask(__name__)
app.secret_key = "your-secret-key-change-in-production"

# Configuration
UPLOAD_FOLDER = "uploads"
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB per file
ALLOWED_EXTENSIONS = {"mp3", "wav", "ogg", "m4a", "aac", "flac"}

# Create uploads directory
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def allowed_file(filename):
    """Check if file extension is allowed"""
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def get_audio_duration(file_path):
    """Get audio duration using FFmpeg"""
    try:
        cmd = [
            "ffprobe",
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            file_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            data = json.loads(result.stdout)
            duration = float(data["format"]["duration"])
            return f"{int(duration // 60)}:{int(duration % 60):02d}"
    except Exception as e:
        print(f"Error getting duration: {e}")
    return "0:00"


def merge_audio_files(file_paths, output_path, quality="192k", fade_duration=0):
    """Merge multiple audio files using FFmpeg with better error handling"""
    temp_dir = None
    try:
        print(f"Merging {len(file_paths)} files...")

        # Create temporary directory
        temp_dir = tempfile.mkdtemp()
        print(f"Temp directory: {temp_dir}")

        # Convert all files to same format first
        converted_files = []
        for i, file_path in enumerate(file_paths):
            print(f"Converting file {i+1}: {os.path.basename(file_path)}")

            converted_file = os.path.join(temp_dir, f"temp_{i}.wav")
            cmd = [
                "ffmpeg",
                "-y",
                "-i",
                file_path,
                "-acodec",
                "pcm_s16le",
                "-ar",
                "44100",
                "-ac",
                "2",
                "-loglevel",
                "error",
                converted_file,
            ]

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if result.returncode != 0:
                print(f"Conversion failed for {file_path}: {result.stderr}")
                return False

            if os.path.exists(converted_file) and os.path.getsize(converted_file) > 0:
                converted_files.append(converted_file)
                print(f"✓ Converted: {converted_file}")
            else:
                print(f"✗ Conversion failed: {converted_file}")
                return False

        # Create concat file list
        concat_file = os.path.join(temp_dir, "filelist.txt")
        with open(concat_file, "w", encoding="utf-8") as f:
            for file_path in converted_files:
                # Use forward slashes for cross-platform compatibility
                safe_path = file_path.replace("\\", "/")
                f.write(f"file '{safe_path}'\n")

        print(f"Created concat file: {concat_file}")

        # Build FFmpeg command for final merge
        cmd = [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concat_file,
            "-c:a",
            "libmp3lame",
            "-b:a",
            quality,
            "-ar",
            "44100",
            "-ac",
            "2",
            "-loglevel",
            "error",
        ]

        # Add fade effects if requested
        if fade_duration > 0:
            fade_filter = (
                f"afade=t=in:ss=0:d={fade_duration},afade=t=out:st=60:d={fade_duration}"
            )
            cmd.extend(["-af", fade_filter])

        cmd.append(output_path)

        print(f"Final merge command: {' '.join(cmd)}")

        # Execute final merge
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

        if result.returncode != 0:
            print(f"Merge failed: {result.stderr}")
            return False

        # Verify output file
        if os.path.exists(output_path):
            file_size = os.path.getsize(output_path)
            print(f"✓ Merge completed! Output size: {file_size} bytes")
            return file_size > 0
        else:
            print("✗ Output file not created")
            return False

    except subprocess.TimeoutExpired:
        print("FFmpeg process timed out")
        return False
    except Exception as e:
        print(f"Merge error: {str(e)}")
        return False
    finally:
        # Always cleanup temp directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
                print(f"✓ Cleaned up temp directory: {temp_dir}")
            except Exception as e:
                print(f"Warning: Failed to cleanup temp dir: {e}")


@app.route("/")
def index():
    """Main page"""
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload_files():
    """Handle file uploads"""
    try:
        if "files" not in request.files:
            return jsonify({"error": "No files selected"}), 400

        files = request.files.getlist("files")
        if not files or all(file.filename == "" for file in files):
            return jsonify({"error": "No files selected"}), 400

        # Create session folder
        session_id = str(uuid.uuid4())
        session_folder = os.path.join(UPLOAD_FOLDER, session_id)
        os.makedirs(session_folder, exist_ok=True)

        uploaded_files = []

        for file in files:
            if file and allowed_file(file.filename):
                # Secure filename and save
                filename = secure_filename(file.filename)
                file_path = os.path.join(session_folder, filename)
                file.save(file_path)

                # Get file info
                file_size = os.path.getsize(file_path)
                duration = get_audio_duration(file_path)

                uploaded_files.append(
                    {
                        "filename": filename,
                        "size": f"{file_size / (1024*1024):.1f} MB",
                        "duration": duration,
                        "path": file_path,
                    }
                )
            else:
                return (
                    jsonify({"error": f"Unsupported file type: {file.filename}"}),
                    400,
                )

        return jsonify({"session_id": session_id, "files": uploaded_files})

    except Exception as e:
        return jsonify({"error": f"Upload failed: {str(e)}"}), 500


@app.route("/merge", methods=["POST"])
def merge_files():
    """Merge uploaded audio files with better error handling"""
    try:
        data = request.json
        session_id = data.get("session_id")
        file_order = data.get("file_order", [])
        quality = data.get("quality", "192k")
        fade_duration = float(data.get("fade_duration", 0))

        if not session_id or not file_order:
            return jsonify({"error": "Missing session ID or file order"}), 400

        session_folder = os.path.join(UPLOAD_FOLDER, session_id)
        if not os.path.exists(session_folder):
            return jsonify({"error": "Session not found"}), 404

        # Build file paths in correct order
        file_paths = []
        for filename in file_order:
            file_path = os.path.join(session_folder, filename)
            if os.path.exists(file_path):
                file_paths.append(file_path)

        if len(file_paths) < 2:
            return jsonify({"error": "At least 2 files required for merging"}), 400

        # Create output file with proper extension
        timestamp = int(time.time())
        output_filename = f"merged_audio_{timestamp}.mp3"  # Fixed extension
        output_path = os.path.join(session_folder, output_filename)

        print(f"Starting merge process for {len(file_paths)} files")
        print(f"Output file: {output_path}")

        # Merge files
        success = merge_audio_files(file_paths, output_path, quality, fade_duration)

        if success and os.path.exists(output_path):
            # Verify file was created properly
            file_size = os.path.getsize(output_path)
            if file_size > 0:
                print(f"Merge successful! File size: {file_size} bytes")
                return jsonify(
                    {
                        "success": True,
                        "download_url": f"/download/{session_id}/{output_filename}",
                        "file_size": f"{file_size / (1024*1024):.1f} MB",
                    }
                )
            else:
                return jsonify({"error": "Merged file is empty"}), 500
        else:
            return jsonify({"error": "Failed to merge audio files"}), 500

    except Exception as e:
        print(f"Merge error: {str(e)}")
        return jsonify({"error": f"Merge failed: {str(e)}"}), 500


@app.route("/download/<session_id>/<filename>")
def download_file(session_id, filename):
    """Download merged file with proper error handling"""
    try:
        # Validate filename extension
        if not filename.endswith(".mp3"):
            return jsonify({"error": "Invalid file format"}), 400

        file_path = os.path.join(UPLOAD_FOLDER, session_id, filename)

        # Check if file exists
        if not os.path.exists(file_path):
            print(f"File not found: {file_path}")
            return jsonify({"error": "File not found or expired"}), 404

        # Check file size
        file_size = os.path.getsize(file_path)
        if file_size == 0:
            print(f"Empty file detected: {file_path}")
            return jsonify({"error": "File is corrupted or empty"}), 500

        # Return file for download
        return send_file(
            file_path, as_attachment=True, download_name=filename, mimetype="audio/mpeg"
        )

    except Exception as e:
        print(f"Download error: {str(e)}")
        return jsonify({"error": f"Download failed: {str(e)}"}), 500


# Separate cleanup route
@app.route("/cleanup/<session_id>")
def cleanup_session(session_id):
    """Clean up session files after successful download"""
    try:
        session_folder = os.path.join(UPLOAD_FOLDER, session_id)
        if os.path.exists(session_folder):
            shutil.rmtree(session_folder)
            return jsonify({"success": True})
    except Exception as e:
        print(f"Cleanup error: {e}")
    return jsonify({"success": False})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
