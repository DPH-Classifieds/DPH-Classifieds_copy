from app import supabase_request
import sys
import os

def apply_migration(migration_file):
    print(f"Applying migration from {migration_file}...")
    
    try:
        with open(migration_file, 'r') as f:
            migration_sql = f.read()

        # Supabase `/rest/v1/sql` accepts a SQL string. Do NOT split by semicolons:
        # migrations include DO $$ blocks and functions that contain internal ';'.
        resp, status = supabase_request(
            'post',
            '/rest/v1/sql',
            data={'query': migration_sql},
            use_service_role=True
        )
        print(f"Migration result: Status {status}")
        if status >= 400:
            print(f"Failed to apply migration: {resp}")
            return False
        return True
    
    except Exception as e:
        print(f"Error applying migration: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python apply_migration.py <migration_file>")
        sys.exit(1)
        
    migration_file = sys.argv[1]
    
    if not os.path.exists(migration_file):
        print(f"Migration file {migration_file} does not exist")
        sys.exit(1)
        
    success = apply_migration(migration_file)
    
    if success:
        print("Migration applied successfully")
    else:
        print("Migration failed")
        sys.exit(1) 
