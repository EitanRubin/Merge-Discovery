"""
Orchestration script to run Noizz2025 and Static_Analysis in sequence.

Workflow:
1. Run Noizz2025 to capture JS files from the target website
2. Extract JS content from JSON files and save as actual .js files
3. Run Static_Analysis on the extracted .js files
4. Convert both outputs to standardized format
5. Merge into unified api_calls_merged.json
"""

import asyncio
import subprocess
import json
import sys
import os
import argparse
from pathlib import Path


# Directory paths
BASE_DIR = Path(__file__).parent
NOIZZ_DIR = BASE_DIR / "Noizz2025"
STATIC_ANALYSIS_DIR = BASE_DIR / "Static_Analysis"
MAPPING_OUTPUT_DIR = NOIZZ_DIR / "mapping_output"
JS_FILES_JSON_DIR = MAPPING_OUTPUT_DIR / "js_files"
EXTRACTED_JS_DIR = MAPPING_OUTPUT_DIR / "extracted_js"
OUTPUTS_DIR = BASE_DIR / "outputs"


def extract_js_from_json_files():
    """Extract JS content from JSON files and save as actual .js files."""
    print("\n" + "=" * 60)
    print("Step 2: Extracting JS content from JSON files")
    print("=" * 60)
    
    # Create output directory for extracted JS files
    EXTRACTED_JS_DIR.mkdir(parents=True, exist_ok=True)
    
    # Clear existing extracted files
    for f in EXTRACTED_JS_DIR.glob("*.js"):
        f.unlink()
    
    extracted_count = 0
    failed_count = 0
    
    json_files = list(JS_FILES_JSON_DIR.glob("*.json"))
    print(f"Found {len(json_files)} JSON files to process")
    
    for json_file in json_files:
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            content = data.get('content')
            url = data.get('url', '')
            
            if content and isinstance(content, str) and len(content) > 0:
                # Create .js filename from the JSON filename
                js_filename = json_file.stem + ".js"
                js_file_path = EXTRACTED_JS_DIR / js_filename
                
                with open(js_file_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                
                extracted_count += 1
                print(f"  ✓ Extracted: {js_filename} ({len(content)} chars)")
            else:
                error = data.get('error', 'No content')
                status = data.get('status', 'unknown')
                failed_count += 1
                print(f"  ✗ Skipped: {json_file.name} (status: {status}, error: {error})")
                
        except Exception as e:
            failed_count += 1
            print(f"  ✗ Error processing {json_file.name}: {e}")
    
    print(f"\nExtraction complete: {extracted_count} files extracted, {failed_count} failed")
    return extracted_count


def run_noizz2025(config_file: str = None, start_url: str = None):
    """Run Noizz2025 API server and trigger mapping."""
    print("\n" + "=" * 60)
    print("Step 1: Running Noizz2025 to capture JS files")
    print("=" * 60)
    
    import httpx
    import time
    
    # Start the API server in background
    print("Starting Noizz2025 API server...")
    server_process = subprocess.Popen(
        [sys.executable, "api_server.py"],
        cwd=str(NOIZZ_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == 'win32' else 0
    )
    
    # Wait for server to start
    max_wait = 30
    server_ready = False
    for i in range(max_wait):
        try:
            response = httpx.get("http://localhost:8000/health", timeout=2)
            if response.status_code == 200:
                server_ready = True
                print("Server is ready!")
                break
        except:
            pass
        time.sleep(1)
        print(f"Waiting for server... ({i+1}/{max_wait})")
    
    if not server_ready:
        print("ERROR: Server failed to start")
        server_process.terminate()
        return False
    
    try:
        # Load config
        config_path = config_file or str(NOIZZ_DIR / "config.json")
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        # Override start_url if provided
        if start_url:
            config['start_url'] = start_url
        
        print(f"Starting mapping for: {config.get('start_url')}")
        
        # Call the mapping endpoint
        response = httpx.post(
            "http://localhost:8000/map",
            json={"config": config},
            timeout=600  # 10 minutes timeout for mapping
        )
        
        if response.status_code == 200:
            result = response.json()
            print(f"\n✓ Mapping complete!")
            print(f"  - UI endpoints: {len(result.get('ui_endpoints', []))}")
            print(f"  - Server endpoints: {len(result.get('server_endpoints', []))}")
            print(f"  - JS files captured: {result.get('js_files_count', 0)}")
            print(f"  - Output directory: {result.get('output_directory')}")
            return True
        else:
            print(f"ERROR: Mapping failed with status {response.status_code}")
            print(response.text)
            return False
            
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        # Stop the server
        print("Stopping server...")
        if sys.platform == 'win32':
            subprocess.run(['taskkill', '/F', '/T', '/PID', str(server_process.pid)], 
                         capture_output=True)
        else:
            server_process.terminate()
        server_process.wait(timeout=5)


def run_static_analysis(output_file: str = None):
    """Run Static_Analysis on the extracted JS files."""
    print("\n" + "=" * 60)
    print("Step 3: Running Static Analysis on JS files")
    print("=" * 60)
    
    if not EXTRACTED_JS_DIR.exists():
        print(f"ERROR: Extracted JS directory not found: {EXTRACTED_JS_DIR}")
        return False
    
    js_files = list(EXTRACTED_JS_DIR.glob("*.js"))
    if not js_files:
        print("ERROR: No JS files found to analyze")
        return False
    
    print(f"Found {len(js_files)} JS files to analyze")
    
    # Build command
    cmd = ["node", "main.js", str(EXTRACTED_JS_DIR), "--deep", "--security", "--performance"]
    
    if output_file:
        cmd.extend(["--json", "--export", output_file])
    
    print(f"Running: {' '.join(cmd)}")
    
    result = subprocess.run(
        cmd,
        cwd=str(STATIC_ANALYSIS_DIR),
        capture_output=False
    )
    
    if result.returncode == 0:
        print("\n✓ Static analysis complete!")
        if output_file:
            print(f"  Report saved to: {output_file}")
        return True
    else:
        print(f"\nERROR: Static analysis failed with return code {result.returncode}")
        return False


def run_static_analysis_only(js_directory: str = None, output_file: str = None):
    """Run only the Static Analysis step on existing JS files."""
    print("\n" + "=" * 60)
    print("Running Static Analysis only")
    print("=" * 60)
    
    # Use provided directory or default to extracted_js
    target_dir = Path(js_directory) if js_directory else EXTRACTED_JS_DIR
    
    if not target_dir.exists():
        print(f"ERROR: JS directory not found: {target_dir}")
        return False
    
    js_files = list(target_dir.glob("*.js"))
    if not js_files:
        print(f"ERROR: No JS files found in {target_dir}")
        return False
    
    print(f"Found {len(js_files)} JS files to analyze in {target_dir}")
    
    # Build command
    cmd = ["node", "main.js", str(target_dir.absolute()), "--deep", "--security", "--performance"]
    
    if output_file:
        cmd.extend(["--json", "--export", output_file])
    
    print(f"Running: {' '.join(cmd)}")
    
    result = subprocess.run(
        cmd,
        cwd=str(STATIC_ANALYSIS_DIR),
        capture_output=False
    )
    
    return result.returncode == 0


def main():
    parser = argparse.ArgumentParser(
        description='Run Noizz2025 and Static_Analysis in sequence',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Full workflow (capture + extract + analyze)
  python run_analysis.py --url http://localhost:4200
  
  # Skip capture, only extract and analyze existing JSON files
  python run_analysis.py --skip-capture
  
  # Only run static analysis on existing extracted JS files
  python run_analysis.py --analyze-only
  
  # Run static analysis on a specific directory
  python run_analysis.py --analyze-only --js-dir ./my_js_files
  
  # Export analysis report to file
  python run_analysis.py --analyze-only --output report.json
        """
    )
    
    parser.add_argument('--url', '-u', help='Target URL to map (overrides config.json)')
    parser.add_argument('--config', '-c', help='Path to Noizz2025 config file')
    parser.add_argument('--skip-capture', action='store_true', 
                        help='Skip Noizz2025 capture step, only extract and analyze')
    parser.add_argument('--analyze-only', action='store_true',
                        help='Only run static analysis on existing JS files')
    parser.add_argument('--js-dir', help='Directory containing JS files (for --analyze-only)')
    parser.add_argument('--output', '-o', help='Output file for analysis report')
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("Merge Discovery - Combined Analysis Pipeline")
    print("=" * 60)
    
    # Mode 1: Only static analysis
    if args.analyze_only:
        success = run_static_analysis_only(args.js_dir, args.output)
        sys.exit(0 if success else 1)
    
    # Mode 2: Skip capture, only extract and analyze
    if args.skip_capture:
        # Check if JSON files exist
        if not JS_FILES_JSON_DIR.exists():
            print(f"ERROR: JS JSON files directory not found: {JS_FILES_JSON_DIR}")
            print("Run without --skip-capture first to capture JS files")
            sys.exit(1)
        
        extracted = extract_js_from_json_files()
        if extracted > 0:
            run_static_analysis(args.output)
            # Convert and merge outputs
            convert_and_merge_outputs()
            print("\n" + "=" * 60)
            print("Pipeline complete!")
            print("=" * 60)
            print("\n📁 Output files:")
            print("   • outputs/noizz25_api_calls.json")
            print("   • outputs/static_analysis_api_calls.json")
            print("   • outputs/api_calls_merged.json (final merged output)")
        else:
            print("No JS files were extracted. Cannot run static analysis.")
            sys.exit(1)
        sys.exit(0)
    
    # Mode 3: Full workflow
    # Step 1: Run Noizz2025
    if not run_noizz2025(args.config, args.url):
        print("\nERROR: Noizz2025 capture failed")
        sys.exit(1)
    
    # Step 2: Extract JS from JSON
    extracted = extract_js_from_json_files()
    
    if extracted == 0:
        print("\nNo JS files were extracted. Cannot run static analysis.")
        sys.exit(1)
    
    # Step 3: Run Static Analysis
    run_static_analysis(args.output)
    
    # Step 4: Convert and Merge outputs
    convert_and_merge_outputs()
    
    print("\n" + "=" * 60)
    print("Pipeline complete!")
    print("=" * 60)
    print("\n📁 Output files:")
    print("   • outputs/noizz25_api_calls.json")
    print("   • outputs/static_analysis_api_calls.json")
    print("   • outputs/api_calls_merged.json (final merged output)")


def convert_and_merge_outputs():
    """Convert outputs to standardized format and merge."""
    print("\n" + "=" * 60)
    print("Step 4: Converting and merging outputs")
    print("=" * 60)
    
    # Run the Node.js pipeline for conversion and merge
    result = subprocess.run(
        ["node", "run_pipeline.js", "--skip-crawl"],
        cwd=str(BASE_DIR),
        capture_output=True,
        text=True
    )
    
    if result.returncode != 0:
        print(f"Warning: Merge step had issues: {result.stderr}")
    
    # Check if merged file was created
    merged_file = OUTPUTS_DIR / "api_calls_merged.json"
    if merged_file.exists():
        with open(merged_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        summary = data.get('summary', {})
        print(f"\n✓ Merged output created:")
        print(f"  - Total API calls found: {summary.get('total_calls_found', 0)}")
        print(f"  - Unique calls: {summary.get('unique_calls', 0)}")
        print(f"  - From Noizz25: {summary.get('sources', {}).get('noizz25', 0)}")
        print(f"  - From Static Analysis: {summary.get('sources', {}).get('static_analysis', 0)}")
    else:
        print("Warning: Merged output file not found")


if __name__ == '__main__':
    main()

