import socket
from zeroconf import IPVersion, ServiceInfo, Zeroconf
from core.logging import get_logger

logger = get_logger("discovery")

class DiscoveryService:
    def __init__(self, port: int = 8000):
        self.port = port
        self.zeroconf = Zeroconf(ip_version=IPVersion.V4Only)
        self.service_info = None

    def start(self):
        try:
            hostname = socket.gethostname()
            local_ip = socket.gethostbyname(hostname)
            
            # If gethostbyname returns loopback, try to find a real LAN IP
            if local_ip.startswith("127."):
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                try:
                    s.connect(("8.8.8.8", 80))
                    local_ip = s.getsockname()[0]
                finally:
                    s.close()

            desc = {'version': '0.1.0', 'path': '/'}
            
            self.service_info = ServiceInfo(
                "_http._tcp.local.",
                f"MediaHub._http._tcp.local.",
                addresses=[socket.inet_aton(local_ip)],
                port=self.port,
                properties=desc,
                server=f"{hostname}.local.",
            )

            logger.info(f"Registering mDNS service: mediahub.local on {local_ip}:{self.port}")
            self.zeroconf.register_service(self.service_info)
        except Exception as e:
            logger.error(f"Failed to start mDNS discovery: {e}")

    def stop(self):
        if self.service_info:
            self.zeroconf.unregister_service(self.service_info)
        self.zeroconf.close()

# Global instance
discovery = DiscoveryService()
