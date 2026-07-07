"""
Local settings persistence (single-user).
Stores app settings as JSON in the same SQLite database as crawl data.
"""
import json
import os
import sqlite3
from contextlib import contextmanager

DB_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'crawlyx.db')


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Initialize the settings table and crawl persistence tables"""
    os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER PRIMARY KEY,
                settings_json TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

    from src.crawl_db import init_crawl_tables
    init_crawl_tables()


def save_user_settings(user_id, settings_dict):
    """Save settings (stores as JSON)"""
    try:
        settings_json = json.dumps(settings_dict)
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO user_settings (user_id, settings_json, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id) DO UPDATE SET
                    settings_json = excluded.settings_json,
                    updated_at = CURRENT_TIMESTAMP
            ''', (user_id, settings_json))
        return True, "Settings saved successfully"
    except Exception as e:
        print(f"Error saving settings: {e}")
        return False, f"Failed to save settings: {str(e)}"


def get_user_settings(user_id):
    """Get settings (returns dict or None)"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT settings_json FROM user_settings WHERE user_id = ?', (user_id,))
            result = cursor.fetchone()
            if result:
                return json.loads(result['settings_json'])
            return None
    except Exception as e:
        print(f"Error fetching settings: {e}")
        return None
