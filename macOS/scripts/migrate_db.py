import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sqlalchemy import create_engine, inspect, text
from agent.store.models import get_engine_url
from loguru import logger

def migrate():
    url = get_engine_url()
    logger.info(f"Checking database for migrations...")
    
    try:
        engine = create_engine(url)
        inspector = inspect(engine)
        
        # Check if events table exists
        if 'events' not in inspector.get_table_names():
            logger.info("Table 'events' does not exist yet. It will be created during initialization.")
            return

        # Check if note column exists
        columns = [c['name'] for c in inspector.get_columns('events')]
        
        if 'note' not in columns:
            logger.info("Adding 'note' column to 'events' table...")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE events ADD COLUMN note TEXT"))
                conn.commit()
            logger.info("Successfully added 'note' column.")
        else:
            logger.info("'note' column already exists in 'events' table.")
            
    except Exception as e:
        logger.error(f"Migration failed: {e}")

if __name__ == "__main__":
    migrate()
