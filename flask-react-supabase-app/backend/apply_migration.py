from app import supabase_request
import sys
import os

def apply_migration(migration_file):
    print(f"Applying migration from {migration_file}...")
    
    try:
        with open(migration_file, 'r') as f:
            migration_sql = f.read()
            
        # Extract the migration name from the filename
        migration_name = os.path.basename(migration_file).replace('.sql', '')
        
        # Split the SQL into separate statements
        statements = migration_sql.split(';')
        
        success = True
        for i, statement in enumerate(statements):
            if not statement.strip():
                continue
                
            print(f"Executing statement {i+1}/{len(statements)}...")
            
            # Apply the statement
            resp, status = supabase_request(
                'post',
                '/rest/v1/sql',
                data={
                    'query': statement.strip() + ';'
                },
                use_service_role=True
            )
            
            print(f"Statement {i+1} result: Status {status}")
            
            if status >= 400:
                print(f"Failed to apply statement {i+1}: {resp}")
                success = False
                break
                
        return success
    
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