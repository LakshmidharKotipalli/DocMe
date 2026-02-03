import yaml
import re
import os
from loguru import logger

class Enricher:
    def __init__(self, rules_path="config/rules.yaml"):
        """
        Initialize Enricher with validated regex patterns from config.
        """
        self.rules_config = self._load_and_validate_rules(rules_path)

    def _validate_regex_pattern(self, pattern: str, max_complexity: int = 100) -> bool:
        """
        Validate regex pattern to prevent ReDoS attacks.
        Returns True if pattern is safe, False otherwise.
        """
        try:
            # Check for known dangerous patterns
            dangerous_patterns = [
                r'\([^()]*\+',  # Nested repetition
                r'\([^()]*\*',  # Nested repetition
                r'([a-z]+\+)+',  # Repeated groups
                r'(.+)\1+',      # Backtracking
            ]

            for dangerous in dangerous_patterns:
                if dangerous in pattern:
                    return False

            # Compile to check syntax
            compiled = re.compile(pattern)

            # Estimate pattern complexity (rough heuristic)
            complexity = len(pattern)
            if complexity > max_complexity:
                logger.warning(f"Regex pattern too complex: {pattern[:50]}...")
                return False

            return True

        except re.error as e:
            logger.error(f"Invalid regex pattern: {pattern} - {e}")
            return False

    def _load_and_validate_rules(self, rules_path: str) -> dict:
        """
        Load and validate all regex patterns from config file.
        """
        try:
            with open(rules_path, 'r') as f:
                config = yaml.safe_load(f)

            # Validate project patterns
            if 'projects' in config:
                for proj in config['projects']:
                    if 'paths' in proj:
                        for path_pattern in proj['paths']:
                            if not self._validate_regex_pattern(re.escape(path_pattern)):
                                logger.warning(f"Invalid project pattern: {path_pattern}")

            # Validate general rules
            if 'rules' in config:
                for rule in config['rules']:
                    pattern = rule.get('pattern', '')
                    if not self._validate_regex_pattern(pattern):
                        logger.warning(f"Removing invalid rule pattern: {pattern[:50]}...")
                        config['rules'].remove(rule)

            return config

        except (IOError, yaml.YAMLError) as e:
            logger.error(f"Failed to load rules config: {e}")
            return {'projects': [], 'rules': []}
        except Exception as e:
            logger.error(f"Unexpected error loading rules: {e}")
            return {'projects': [], 'rules': []}

    def infer_project_and_tags(self, app: str, window_title: str) -> tuple:
        """
        Infer project and tags based on app name and window title.
        Uses validated regex patterns from config.
        """
        project = "Unknown"
        tags = []

        try:
            # Check projects from config
            for proj in self.rules_config.get('projects', []):
                for path_pattern in proj.get('paths', []):
                    # Use simple string matching for project paths
                    if path_pattern.lower() in window_title.lower() or path_pattern.lower() in app.lower():
                        project = proj.get('name')
                        tags.extend(proj.get('tags', []))
                        break

            # Check general tagging rules with validated regex
            for rule in self.rules_config.get('rules', []):
                pattern = rule.get('pattern')
                try:
                    if re.search(pattern, window_title, re.IGNORECASE):
                        tags.extend(rule.get('tags', []))
                except re.error:
                    logger.debug(f"Regex error matching pattern: {pattern[:50]}...")
                    continue

            return project, list(set(tags))

        except Exception as e:
            logger.error(f"Error inferring project/tags: {e}")
            return project, tags

    def redact_text(self, text: str, redact_config_path: str = "config/redact.yaml") -> str:
        """
        Redact sensitive information from text using validated patterns.
        """
        try:
            with open(redact_config_path, 'r') as f:
                redact_config = yaml.safe_load(f)

            redacted_text = text
            for pattern in redact_config.get('redaction_patterns', []):
                # Validate pattern before using
                if self._validate_regex_pattern(pattern):
                    try:
                        redacted_text = re.sub(pattern, "[REDACTED]", redacted_text, flags=re.IGNORECASE)
                    except re.error:
                        logger.debug(f"Failed to apply redaction pattern: {pattern[:50]}...")
                        continue
                else:
                    logger.warning(f"Skipping unsafe redaction pattern: {pattern[:50]}...")

            return redacted_text

        except (IOError, yaml.YAMLError) as e:
            logger.error(f"Failed to load redaction config: {e}")
            return text
        except Exception as e:
            logger.error(f"Unexpected error in redact_text: {e}")
            return text
