"""
Shared configuration loader module for DocMe.

This module provides a centralized way to load configuration from multiple locations,
eliminating code duplication across the application.
"""

import os
import sys
import yaml
from typing import Dict, Any, Optional
from loguru import logger


class ConfigLoader:
    """
    Centralized configuration loader with support for multiple file locations
    and environment variable overrides.
    """

    # Configuration file search paths
    DEFAULT_SEARCH_PATHS = []

    @classmethod
    def _get_default_search_paths(cls) -> list:
        """
        Get default configuration file search paths based on platform.
        """
        paths = []

        # Check environment variable first (set by Electron)
        env_config = os.environ.get('DOCME_CONFIG_PATH')
        if env_config and os.path.exists(env_config):
            paths.insert(0, env_config)

        # Platform-specific paths
        if sys.platform == "darwin":
            paths.append(os.path.expanduser("~/Library/Application Support/DocMe/docme.yaml"))
        elif sys.platform == "win32":
            paths.append(os.path.join(os.environ.get("APPDATA", ""), "DocMe", "docme.yaml"))

        # Fallback to development path
        paths.append("config/docme.yaml")

        return paths

    @classmethod
    def load_config(cls, custom_path: Optional[str] = None) -> Dict[str, Any]:
        """
        Load configuration from multiple possible locations.

        Priority:
        1. Custom path if provided
        2. Environment variable DOCME_CONFIG_PATH
        3. Platform-specific application directory
        4. Default development path

        Args:
            custom_path: Optional custom configuration file path

        Returns:
            Dictionary containing configuration, or empty dict if no config found
        """
        search_paths = []

        # Add custom path if provided
        if custom_path and os.path.exists(custom_path):
            search_paths.append(custom_path)

        # Add default search paths
        search_paths.extend(cls._get_default_search_paths())

        # Remove duplicates while preserving order
        seen = set()
        unique_paths = []
        for path in search_paths:
            if path not in seen:
                seen.add(path)
                unique_paths.append(path)

        # Try to load from each path
        for config_path in unique_paths:
            if os.path.exists(config_path):
                try:
                    with open(config_path, 'r') as f:
                        config = yaml.safe_load(f)
                        logger.debug(f"Loaded configuration from: {config_path}")
                        return config
                except (IOError, yaml.YAMLError) as e:
                    logger.error(f"Failed to load config from {config_path}: {e}")
                    continue

        # Return empty config if nothing found
        logger.warning("No configuration file found, using defaults")
        return {}

    @classmethod
    def get_env_value(cls, config_key: str, env_var: str, config: Optional[Dict] = None, default: Any = None) -> Any:
        """
        Get configuration value from environment variable with fallback to config file.

        Args:
            config_key: Key to look up in config dict (supports dot notation, e.g., 'database.type')
            env_var: Environment variable name
            config: Configuration dictionary (will load if not provided)
            default: Default value if not found

        Returns:
            Configuration value from environment, config file, or default
        """
        # Try environment variable first
        env_value = os.environ.get(env_var)
        if env_value is not None:
            return env_value

        # Load config if not provided
        if config is None:
            config = cls.load_config()

        # Navigate through nested config using dot notation
        keys = config_key.split('.')
        value = config
        for key in keys:
            if isinstance(value, dict):
                value = value.get(key)
            else:
                return default

        # Return value or default
        return value if value is not None else default

    @classmethod
    def get_database_config(cls) -> Dict[str, Any]:
        """
        Get database configuration with environment variable overrides.

        Returns:
            Dictionary with database configuration
        """
        config = cls.load_config()
        db_config = config.get('database', {})

        # Override with environment variables if set
        return {
            'type': os.environ.get('DOCME_DB_TYPE') or db_config.get('type', 'sqlite'),
            'sqlite_path': os.environ.get('DOCME_DB_SQLITE_PATH') or db_config.get('sqlite_path', ''),
            'user': os.environ.get('DOCME_DB_USER') or db_config.get('postgres', {}).get('user', ''),
            'password': os.environ.get('DOCME_DB_PASSWORD') or db_config.get('postgres', {}).get('password', ''),
            'host': os.environ.get('DOCME_DB_HOST') or db_config.get('postgres', {}).get('host', 'localhost'),
            'port': os.environ.get('DOCME_DB_PORT') or db_config.get('postgres', {}).get('port', 5432),
            'dbname': os.environ.get('DOCME_DB_NAME') or db_config.get('postgres', {}).get('dbname', 'docme'),
        }

    @classmethod
    def get_llm_config(cls) -> Dict[str, Any]:
        """
        Get LLM configuration with environment variable overrides.

        Returns:
            Dictionary with LLM configuration
        """
        config = cls.load_config()
        llm_config = config.get('llm', {})

        # Override with environment variables if set
        return {
            'provider': os.environ.get('DOCME_LLM_PROVIDER') or llm_config.get('provider', 'openai'),
            'api_key': os.environ.get('DOCME_LLM_API_KEY') or llm_config.get('api_key', ''),
            'base_url': os.environ.get('DOCME_LLM_BASE_URL') or llm_config.get('base_url', ''),
            'model': os.environ.get('DOCME_LLM_MODEL') or llm_config.get('model', ''),
        }

    @classmethod
    def get_data_path(cls) -> str:
        """
        Get the data directory path for storing application data.

        Returns:
            Path to data directory
        """
        # Check environment variable first
        env_path = os.environ.get('DOCME_DATA_PATH')
        if env_path:
            return env_path

        # Platform-specific defaults
        if sys.platform == "darwin":
            return os.path.expanduser("~/Library/Application Support/DocMe")
        elif sys.platform == "win32":
            return os.path.join(os.environ.get("APPDATA", ""), "DocMe")
        else:
            return os.path.expanduser("~/.docme")
