import base64
import hashlib
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
root=Path('.cache/browser-fixtures');root.mkdir(exist_ok=True)
key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
public=key.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)
fingerprint=':'.join(f'{b:02x}' for b in hashlib.md5(public,usedforsecurity=False).digest())
(root/'key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
(root/'config').write_text(f'[DEFAULT]\nuser=ocid1.user.oc1..qa\ntenancy=ocid1.tenancy.oc1..qa\nregion=us-ashburn-1\nfingerprint={fingerprint}\nkey_file=key.pem\n')

# Self-generated, silent one-second video for click-to-load media checks.
(root/'post-video.webm').write_bytes(base64.b64decode('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJQEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEyTbuMU6uEHFO7a1OsggI67AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjMuMS4xMDBXQYxMYXZmNjMuMS4xMDBEiYhAj0AAAAAAABZUrmvXrgEAAAAAAABO14EBc8WIhK51bEz/LFmcgQAitZyDdW5kiIEAhoVWX1ZQOYOBASPjg4QL68IA4JCwgSC6gSCagQJVsIRVuYEBVe6BAOwBAAAAAAAAAgAAElTDZ/5zc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYzLjEuMTAwc3PZY8CLY8WIhK51bEz/LFlnyKRFo4dFTkNPREVSRIeXTGF2YzYzLjEuMTAwIGxpYnZweC12cDlnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwMDAwMDAwMAAfQ7Z1QH/ngQCjpoEAAICCSYNCAAHwAfYAOCQcGEoAADBwAABzrv//9kIG/jXHeLfgo5OBAMgAhgBAkpwAUAAAAyAAAENAo5OBAZAAhgBAkpwATuAAAyAAAENAo5OBAlgAhgBAkpwAUAAAAyAAAENAo5OBAyAAhgBAkpwATUAAAyAAAENAHFO7a5G7j7OBALeK94EB8YIBtfCBAw=='))
