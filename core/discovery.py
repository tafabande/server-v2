import socket
import os
from core.logging import get_logger

logger = get_logger("discovery")

class DiscoveryService:
    def __init__(self, port: int = 51733):
        self.port = port
        self.zeroconf = None
        self.service_info = None

    def start(self):
        try:
            os.environ["ZEROCONF_USE_CYTHON"] = "0"
            from zeroconf import IPVersion, ServiceInfo, Zeroconf
            self.zeroconf = Zeroconf(ip_version=IPVersion.V4Only)
            hostname = socket.gethostname()
            
            def get_local_ip():
                try:
                    import psutil
                    for interface, addrs in psutil.net_if_addrs().items():
                        for addr in addrs:
                            if addr.family == socket.AF_INET and not addr.address.startswith("127."):
                                return addr.address
                except ImportError:
                    pass
                
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                try:
                    s.connect(("192.168.1.254", 80))
                    return s.getsockname()[0]
                except Exception:
                    return socket.gethostbyname(socket.gethostname())
                finally:
                    s.close()

            local_ip = get_local_ip()
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
        except BaseException as e:
            logger.debug(f"mDNS LAN discovery disabled (incompatible environment): {e}")

    def stop(self):
        try:
            if self.service_info and self.zeroconf:
                self.zeroconf.unregister_service(self.service_info)
        except Exception as e:
            logger.debug(f"Error unregistering service during shutdown: {e}")
        finally:
            try:
                if self.zeroconf:
                    self.zeroconf.close()
            except Exception:
                pass

# Global instance
discovery = DiscoveryService()
