from dataclasses import dataclass
from urllib.parse import SplitResult, quote, urlsplit

# стандартные порты: в адресе их не пишут
DEFAULT_PORTS = {"http": 80, "https": 443}
# символы, которые можно оставить в пути адреса как есть
SAFE_PATH_CHARS = "/%:@!$&'()*+,;=-._~"


# разобранный адрес сайта
@dataclass(frozen=True)
class SiteAddress:
    base_url: str
    origin: str
    base_path: str


# схема и origin из разобранного адреса; при ошибке — ValueError
def build_origin(parts: SplitResult) -> str:
    try:
        port = parts.port
    except ValueError:
        raise ValueError("Не удалось разобрать адрес сайта") from None

    scheme = parts.scheme.lower()
    if scheme not in DEFAULT_PORTS:
        raise ValueError("Адрес должен начинаться с http:// или https://")
    if parts.username or parts.password:
        raise ValueError("Адрес не должен содержать логин и пароль")

    host = parts.hostname
    if not host:
        raise ValueError("В адресе нет домена")
    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError:
        raise ValueError("Некорректный домен") from None
    if ":" in host:
        host = f"[{host}]"

    netloc = host if port in (None, DEFAULT_PORTS[scheme]) else f"{host}:{port}"
    return f"{scheme}://{netloc}"


# путь адреса в процентной записи
def encode_path(path: str) -> str:
    return quote(path or "/", safe=SAFE_PATH_CHARS)


# разбирает адрес сайта и приводит его к единому виду;
# при ошибке выбрасывает ValueError с понятным текстом
def parse_site_url(raw: str) -> SiteAddress:
    text = raw.strip()
    try:
        parts = urlsplit(text)
    except ValueError:
        raise ValueError("Не удалось разобрать адрес сайта") from None
    origin = build_origin(parts)
    if "?" in text or "#" in text:
        raise ValueError("Адрес не должен содержать параметры (?) и якорь (#)")

    path = encode_path(parts.path)
    last_segment = path.rsplit("/", 1)[-1]
    if not path.endswith("/") and "." not in last_segment:
        path += "/"
    base_path = path if path.endswith("/") else path.rsplit("/", 1)[0] + "/"

    return SiteAddress(base_url=origin + path, origin=origin, base_path=base_path)


# проверяет, что адрес страницы относится к сайту: тот же origin и путь внутри папки сайта
def page_belongs_to_site(url: str, origin: str, base_path: str) -> bool:
    try:
        parts = urlsplit(url)
        page_origin = build_origin(parts)
    except ValueError:
        return False
    if page_origin != origin:
        return False
    path = encode_path(parts.path)
    return path.startswith(base_path) or path + "/" == base_path