import os
import datetime
from pathlib import Path
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

def generate_pki(output_dir="certs", common_name="MediaHub Local CA"):
    out = Path(output_dir)
    out.mkdir(exist_ok=True)
    
    # 1. Generate Root CA Key
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=4096)
    
    # 2. Generate Root CA Certificate
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, common_name),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "MediaHub LAN"),
    ])
    
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.utcnow())
        .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(ca_key, hashes.SHA256())
    )
    
    # 3. Save CA files
    with open(out / "ca.key", "wb") as f:
        f.write(ca_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
    with open(out / "ca.crt", "wb") as f:
        f.write(ca_cert.public_bytes(serialization.Encoding.PEM))
        
    print(f"✅ Root CA Generated: {out / 'ca.crt'}")
    print("💡 Install this CA certificate on your devices to trust the MediaHub LAN server.")

    # 4. Generate Server Key
    server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    
    # 5. Generate Server CSR and Certificate
    # We add common SANs like localhost and .local
    import socket
    hostname = socket.gethostname()
    try:
        local_ip = socket.gethostbyname(hostname)
    except:
        local_ip = "127.0.0.1"

    server_subject = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "mediahub.local"),
    ])
    
    server_cert = (
        x509.CertificateBuilder()
        .subject_name(server_subject)
        .issuer_name(subject)
        .public_key(server_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.utcnow())
        .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=825))
        .add_extension(
            x509.SubjectAlternativeName([
                x509.DNSName("localhost"),
                x509.DNSName("mediahub.local"),
                x509.DNSName(f"{hostname}.local"),
                x509.IPAddress(os.inet_aton("127.0.0.1")),
                x509.IPAddress(os.inet_aton(local_ip)),
            ]),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )
    
    # 6. Save Server files
    with open(out / "server.key", "wb") as f:
        f.write(server_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
    with open(out / "server.crt", "wb") as f:
        f.write(server_cert.public_bytes(serialization.Encoding.PEM))
        
    print(f"✅ Server Certificate Generated: {out / 'server.crt'}")

if __name__ == "__main__":
    # Check if cryptography is installed
    try:
        pass
    except ImportError:
        print("❌ Error: 'cryptography' library not found. Run 'pip install cryptography' first.")
        exit(1)
    
    generate_pki()
