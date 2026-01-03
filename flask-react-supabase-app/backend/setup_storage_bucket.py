#!/usr/bin/env python3
"""
Setup Supabase Storage bucket for listing images.
Run this once to create the bucket with public access.
"""

import os
import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

def create_storage_bucket():
    """Create a public storage bucket for listing images"""
    
    headers = {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
        'Content-Type': 'application/json'
    }
    
    # Create bucket
    bucket_data = {
        'id': 'listing-images',
        'name': 'listing-images',
        'public': True,
        'file_size_limit': 5242880,  # 5MB
        'allowed_mime_types': ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    }
    
    print("Creating storage bucket...")
    response = requests.post(
        f"{SUPABASE_URL}/storage/v1/bucket",
        headers=headers,
        json=bucket_data
    )
    
    if response.status_code in [200, 201]:
        print("✓ Storage bucket 'listing-images' created successfully!")
        return True
    elif response.status_code == 400:
        # Check if it's a duplicate error (bucket already exists)
        try:
            error_data = response.json()
            if 'already exists' in error_data.get('message', '').lower() or error_data.get('error') == 'Duplicate':
                print("✓ Storage bucket 'listing-images' already exists")
                return True
        except:
            pass
        print(f"✗ Failed to create bucket: {response.status_code}")
        print(f"  Response: {response.text}")
        return False
    elif response.status_code == 409:
        print("✓ Storage bucket 'listing-images' already exists")
        return True
    else:
        print(f"✗ Failed to create bucket: {response.status_code}")
        print(f"  Response: {response.text}")
        return False

if __name__ == '__main__':
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        print("✗ Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")
        exit(1)
    
    success = create_storage_bucket()
    
    if success:
        print("\n✓ Setup complete! Images will now be stored in Supabase Storage.")
        print("  Benefits:")
        print("  - Fast CDN-backed delivery")
        print("  - Automatic image optimization")
        print("  - No server storage needed")
    else:
        print("\n✗ Setup failed. Please check your Supabase credentials.")
        exit(1)
