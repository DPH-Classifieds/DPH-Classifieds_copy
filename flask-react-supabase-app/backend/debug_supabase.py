#!/usr/bin/env python3
"""
Debug script to test Supabase connectivity issues
This script helps isolate the root cause of connection failures
"""

import os
import sys
import socket
import requests
from dotenv import load_dotenv

def test_dns_resolution(hostname):
    """Test DNS resolution for a hostname"""
    print(f"\n=== Testing DNS Resolution for {hostname} ===")
    try:
        ip = socket.gethostbyname(hostname)
        print(f"✅ DNS Resolution SUCCESS: {hostname} -> {ip}")
        return True, ip
    except socket.gaierror as e:
        print(f"❌ DNS Resolution FAILED: {e}")
        return False, None

def test_http_connectivity(url, headers=None, timeout=10):
    """Test HTTP connectivity to a URL"""
    print(f"\n=== Testing HTTP Connectivity to {url} ===")
    try:
        response = requests.get(url, headers=headers, timeout=timeout)
        print(f"✅ HTTP Request SUCCESS: Status {response.status_code}")
        print(f"Response headers: {dict(response.headers)}")
        return True, response
    except requests.exceptions.ConnectionError as e:
        print(f"❌ HTTP Connection FAILED: {e}")
        return False, None
    except requests.exceptions.Timeout as e:
        print(f"❌ HTTP Request TIMEOUT: {e}")
        return False, None
    except Exception as e:
        print(f"❌ HTTP Request FAILED: {e}")
        return False, None

def main():
    print("🔍 SUPABASE CONNECTIVITY DIAGNOSTIC TOOL")
    print("=" * 50)
    
    # Load environment variables
    print("\n=== Loading Environment Variables ===")
    load_dotenv()
    
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    
    print(f"SUPABASE_URL: {supabase_url}")
    print(f"SUPABASE_KEY exists: {bool(supabase_key)}")
    print(f"SERVICE_KEY exists: {bool(service_key)}")
    
    if not supabase_url or not supabase_key:
        print("❌ CRITICAL: Missing Supabase configuration!")
        return False
    
    # Extract hostname from URL
    hostname = supabase_url.replace('https://', '').replace('http://', '')
    
    # Test 1: DNS Resolution
    dns_success, ip_address = test_dns_resolution(hostname)
    if not dns_success:
        print("\n💡 DNS RESOLUTION FAILED - POSSIBLE SOLUTIONS:")
        print("1. Flush DNS cache: sudo dscacheutil -flushcache")
        print("2. Change DNS servers to 8.8.8.8 and 8.8.4.4")
        print("3. Check network connectivity")
        print("4. Check if behind corporate firewall")
        return False
    
    # Test 2: Basic HTTP connectivity
    http_success, response = test_http_connectivity(f"{supabase_url}/rest/v1/")
    if not http_success:
        print("\n💡 HTTP CONNECTIVITY FAILED - POSSIBLE SOLUTIONS:")
        print("1. Check firewall settings")
        print("2. Check if VPN is interfering")
        print("3. Verify Supabase project status")
        return False
    
    # Test 3: Auth endpoint
    print(f"\n=== Testing Supabase Auth Endpoint ===")
    auth_success, auth_response = test_http_connectivity(
        f"{supabase_url}/auth/v1/health",
        headers={'apikey': supabase_key}
    )
    
    # Test 4: REST endpoint with API key
    print(f"\n=== Testing Supabase REST with API Key ===")
    rest_success, rest_response = test_http_connectivity(
        f"{supabase_url}/rest/v1/",
        headers={'apikey': supabase_key, 'Authorization': f'Bearer {supabase_key}'}
    )
    
    # Summary
    print(f"\n{'='*50}")
    print("🎯 DIAGNOSTIC SUMMARY")
    print(f"{'='*50}")
    print(f"DNS Resolution: {'✅ PASS' if dns_success else '❌ FAIL'}")
    print(f"HTTP Connectivity: {'✅ PASS' if http_success else '❌ FAIL'}")
    print(f"Auth Endpoint: {'✅ PASS' if auth_success else '❌ FAIL'}")
    print(f"REST Endpoint: {'✅ PASS' if rest_success else '❌ FAIL'}")
    
    if all([dns_success, http_success, auth_success, rest_success]):
        print("\n🎉 ALL TESTS PASSED! Supabase connectivity is working.")
        print("The issue might be in your Flask application code or configuration.")
        return True
    else:
        print("\n⚠️  SOME TESTS FAILED. See solutions above.")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)