import subprocess
import time
import threading
import os
import difflib
import hashlib
import yaml
from loguru import logger

class LogicTracker:
    def __init__(self, interval_sec=30, record_callback=None, watch_dirs=None, config_path=None):
        self.interval = interval_sec
        self.record_callback = record_callback
        self.watch_dirs = watch_dirs or [os.getcwd()]
        self.config_path = self._find_config(config_path)
        self.running = False
        self.thread = None
        self.file_cache = {} 
        self.code_extensions = {'.py', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.sh', '.yaml', '.yml', '.sql', '.md'}
        self.llm_client = None
        self.llm_config = None
        self._init_llm()

    def _find_config(self, config_path):
        """Find config file using environment variable and platform defaults."""
        import sys
        search_paths = []
        
        if config_path and os.path.exists(config_path):
            return config_path
        
        # Check environment variable first (set by Electron)
        env_config = os.environ.get('DOCME_CONFIG_PATH')
        if env_config and os.path.exists(env_config):
            return env_config
        
        if sys.platform == "darwin":
            mac_path = os.path.expanduser("~/Library/Application Support/DocMe/docme.yaml")
            if os.path.exists(mac_path):
                return mac_path
        elif sys.platform == "win32":
            win_path = os.path.join(os.environ.get("APPDATA", ""), "DocMe", "docme.yaml")
            if os.path.exists(win_path):
                return win_path
        
        if os.path.exists("config/docme.yaml"):
            return "config/docme.yaml"
        
        return config_path or "config/docme.yaml"

    def _init_llm(self):
        """Initialize LLM client for diff summarization."""
        try:
            with open(self.config_path, 'r') as f:
                config = yaml.safe_load(f)
            
            self.llm_config = config.get('llm', {})
            if self.llm_config.get('base_url'):
                from openai import OpenAI
                self.llm_client = OpenAI(
                    api_key=self.llm_config.get('api_key') or "dummy",
                    base_url=self.llm_config.get('base_url')
                )
                logger.info("LogicTracker: LLM summarization enabled")
        except Exception as e:
            logger.debug(f"LogicTracker: LLM not configured ({e})")
            self.llm_client = None

    def get_content_diffs(self):
        """Strictly content-based diffing that ignores Git state."""
        diffs = []
        changed_files = []
        
        max_depth = 4 # Safety limit for traversing user directories
        for d in self.watch_dirs:
            path = os.path.expanduser(d)
            if not os.path.exists(path): continue
            
            base_depth = path.count(os.sep)
            for root, dirs, files in os.walk(path):
                # Apply depth limit
                current_depth = root.count(os.sep)
                if current_depth - base_depth >= max_depth:
                    dirs[:] = [] # Skip subdirectories
                    continue

                # Skip noise
                dirs[:] = [d for d in dirs if not d.startswith('.') and d not in {'node_modules', '__pycache__', 'data', '.venv', 'dist', 'build', 'release', 'electron', 'Library', 'Applications'}]
                
                for file in files:
                    if any(file.endswith(ext) for ext in self.code_extensions):
                        full_path = os.path.join(root, file)
                        try:
                            # Skip very large files to avoid memory spikes (max 500KB)
                            if os.path.getsize(full_path) > 500 * 1024:
                                continue

                            with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
                                current_content = f.read()
                            
                            # Content-aware change detection
                            if full_path in self.file_cache:
                                if self.file_cache[full_path] != current_content:
                                    diff = difflib.unified_diff(
                                        self.file_cache[full_path].splitlines(),
                                        current_content.splitlines(),
                                        fromfile=f'a/{file}',
                                        tofile=f'b/{file}',
                                        lineterm=''
                                    )
                                    diff_text = '\n'.join(list(diff))
                                    if diff_text:
                                        diffs.append(diff_text)
                                        changed_files.append(file)
                            
                            self.file_cache[full_path] = current_content
                        except:
                            continue
        
        return '\n'.join(diffs), changed_files

    def summarize_with_llm(self, diff_text, changed_files):
        """Use LLM to generate a human-readable summary of code changes."""
        # Reload config to pick up UI changes
        try:
            with open(self.config_path, 'r') as f:
                config = yaml.safe_load(f)
            self.llm_config = config.get('llm', {})
            # Only re-init if base_url changed or client is None
            if self.llm_config.get('base_url'):
                from openai import OpenAI
                self.llm_client = OpenAI(
                    api_key=self.llm_config.get('api_key') or "dummy",
                    base_url=self.llm_config.get('base_url')
                )
        except:
            pass

        if not self.llm_client or not diff_text:
            return None
        
        try:
            # Truncate diff if too long
            max_diff_chars = 3000
            truncated_diff = diff_text[:max_diff_chars]
            if len(diff_text) > max_diff_chars:
                truncated_diff += "\n... (truncated)"
            
            prompt = f"""Analyze this code diff and provide a brief, one-line summary of what changed.
Focus on the functional change, not the files modified.

Changed files: {', '.join(changed_files)}

Diff:
```
{truncated_diff}
```

Respond with ONLY a brief summary (max 15 words), like:
- "Added user authentication to API endpoints"
- "Fixed scrolling issue in dashboard"
- "Refactored database connection handling"
"""
            
            response = self.llm_client.chat.completions.create(
                model=self.llm_config.get('model', 'gemma3:1b'),
                messages=[{"role": "user", "content": prompt}],
                max_tokens=50,
                temperature=0.3
            )
            
            summary = response.choices[0].message.content.strip()
            # Clean up the response
            summary = summary.replace('"', '').replace("'", "")
            if summary.startswith('-'):
                summary = summary[1:].strip()
            
            logger.debug(f"LLM diff summary: {summary}")
            return summary
            
        except Exception as e:
            logger.debug(f"LLM summarization failed: {e}")
            return None

    def summarize_logic_change(self, diff_text):
        """Fallback rule-based summary if LLM is not available."""
        if not diff_text:
            return None
            
        lines = diff_text.splitlines()
        summary_lines = []
        for line in lines:
            if line.startswith('@@'):
                summary_lines.append(line)
            elif line.startswith('+') and not line.startswith('+++'):
                logic_keywords = ["def ", "class ", "if ", "for ", "while ", "return ", "import ", "function ", "const ", "let "]
                if any(kw in line for kw in logic_keywords):
                    summary_lines.append(line[:100])
        
        if not summary_lines:
            return None
            
        return "\n".join(summary_lines[:10])

    def _run(self):
        logger.info(f"LogicTracker active ({self.interval}s interval).")
        
        # Prime the cache on startup so we don't log existing diffs
        self.get_content_diffs()
        
        while self.running:
            time.sleep(self.interval)
            
            diff, changed_files = self.get_content_diffs()
            if diff:
                # Try LLM summarization first
                llm_summary = self.summarize_with_llm(diff, changed_files)
                
                # Fallback to rule-based
                rule_summary = self.summarize_logic_change(diff)
                
                if (llm_summary or rule_summary) and self.record_callback:
                    window_title = f"Code changed: {', '.join(changed_files[:3])}"
                    if len(changed_files) > 3:
                        window_title += f" +{len(changed_files) - 3} more"
                    
                    payload = {
                        "diff_summary": rule_summary,
                        "changed_files": changed_files,
                    }
                    if llm_summary:
                        payload["ai_summary"] = llm_summary
                    
                    # Save the AI summary as a note on this event
                    note = llm_summary if llm_summary else None
                    
                    self.record_callback("logic_tracker", "Code", window_title, payload, note=note)

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=2)
