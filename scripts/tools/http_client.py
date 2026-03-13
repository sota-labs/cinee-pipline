"""HTTP client for calling Node.js tool endpoints."""
import os
import requests
from typing import Any, Dict, Optional

# Node.js API base URL
NODEJS_BASE_URL = os.getenv("NODEJS_API_URL", "http://localhost:3000")


def call_nodejs_tool(endpoint: str, method: str = "POST", data: Optional[Dict] = None, params: Optional[Dict] = None) -> Any:
    """Call a Node.js tool endpoint.
    
    Args:
        endpoint: API endpoint path (e.g., /api/tools/twitter/post)
        method: HTTP method (GET or POST)
        data: Request body data for POST requests
        params: Query parameters for GET requests
        
    Returns:
        Response data from the Node.js API
    """
    url = f"{NODEJS_BASE_URL}{endpoint}"
    
    try:
        if method.upper() == "GET":
            response = requests.get(url, params=params or {}, timeout=30)
        else:
            response = requests.post(url, json=data or {}, timeout=30)
        
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        return {"success": False, "error": str(e)}
