import yaml
import re
import os

class Enricher:
    def __init__(self, rules_path="config/rules.yaml"):
        with open(rules_path, 'r') as f:
            self.rules_config = yaml.safe_load(f)

    def infer_project_and_tags(self, app, window_title):
        project = "Unknown"
        tags = []

        # Check projects from config
        for proj in self.rules_config.get('projects', []):
            for path_pattern in proj.get('paths', []):
                if path_pattern.lower() in window_title.lower() or path_pattern.lower() in app.lower():
                    project = proj.get('name')
                    tags.extend(proj.get('tags', []))
                    break
        
        # Check general tagging rules
        for rule in self.rules_config.get('rules', []):
            pattern = rule.get('pattern')
            if re.search(pattern, window_title, re.IGNORECASE):
                tags.extend(rule.get('tags', []))

        return project, list(set(tags))

    def redact_text(self, text, redact_config_path="config/redact.yaml"):
        with open(redact_config_path, 'r') as f:
            redact_config = yaml.safe_load(f)
        
        redacted_text = text
        for pattern in redact_config.get('redaction_patterns', []):
            redacted_text = re.sub(pattern, "[REDACTED]", redacted_text)
        
        return redacted_text
