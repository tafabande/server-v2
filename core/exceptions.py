from fastapi import HTTPException, status

class MediaHubError(Exception):
    """Base exception for all MediaHub errors."""
    def __init__(self, message: str, status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)

class ResourceNotFoundError(MediaHubError):
    def __init__(self, message: str = "The requested resource was not found."):
        super().__init__(message, status_code=status.HTTP_404_NOT_FOUND)

class AccessDeniedError(MediaHubError):
    def __init__(self, message: str = "Access denied."):
        super().__init__(message, status_code=status.HTTP_403_FORBIDDEN)

class AuthenticationError(MediaHubError):
    def __init__(self, message: str = "Authentication failed."):
        super().__init__(message, status_code=status.HTTP_401_UNAUTHORIZED)

class ConfigurationError(MediaHubError):
    def __init__(self, message: str = "System configuration error."):
        super().__init__(message, status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)

class FileOperationError(MediaHubError):
    def __init__(self, message: str = "A file operation error occurred."):
        super().__init__(message, status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
