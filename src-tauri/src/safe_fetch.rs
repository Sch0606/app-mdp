//! Téléchargements sortants protégés contre la SSRF.
//!
//! Les adresses des sites proviennent du coffre, donc potentiellement d’un fichier
//! importé. Chaque requête (et chaque redirection) est revalidée : schéma HTTP(S),
//! port standard, résolution DNS vers des adresses publiques uniquement, connexion
//! épinglée sur l’adresse vérifiée (pas de rebinding DNS), taille et durée bornées.

use std::{
    io::Read,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs},
    time::Duration,
};

use reqwest::{blocking::Client, header::CONTENT_TYPE, redirect::Policy};
use url::Url;

const MAX_REDIRECTS: usize = 4;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(4);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

pub struct FetchedResource {
    pub final_url: Url,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
        || a == 0
        || (a == 100 && (64..=127).contains(&b)) // 100.64.0.0/10 (CGNAT)
        || (a == 192 && b == 0 && c == 0) // 192.0.0.0/24
        || (a == 198 && (b == 18 || b == 19)) // 198.18.0.0/15
        || a >= 240) // 240.0.0.0/4 réservé
}

fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_public_ipv4(v4);
    }
    let segments = ip.segments();
    // NAT64 (64:ff9b::/96) : l’adresse IPv4 embarquée fait foi.
    if segments[..6] == [0x64, 0xff9b, 0, 0, 0, 0] {
        let [a, b] = segments[6].to_be_bytes();
        let [c, d] = segments[7].to_be_bytes();
        return is_public_ipv4(Ipv4Addr::new(a, b, c, d));
    }
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        || (segments[0] & 0xfe00) == 0xfc00 // fc00::/7 unique local
        || (segments[0] & 0xffc0) == 0xfe80 // fe80::/10 link-local
        || (segments[0] & 0xffc0) == 0xfec0 // fec0::/10 site-local (obsolète)
        || (segments[0] == 0x2001 && segments[1] == 0x0db8) // documentation
        || segments[..6] == [0, 0, 0, 0, 0, 0]) // IPv4-compatible obsolète
}

pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_ipv4(v4),
        IpAddr::V6(v6) => is_public_ipv6(v6),
    }
}

/// Vérifie l’URL et renvoie l’adresse publique sur laquelle épingler la connexion.
fn validate_target(url: &Url) -> Result<(String, SocketAddr), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Protocole refusé.".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Identifiants interdits dans l’adresse.".to_string());
    }
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "Port introuvable.".to_string())?;
    if url.port().is_some() && !matches!(port, 80 | 443) {
        return Err("Port non standard refusé.".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "Hôte introuvable.".to_string())?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return Err("Hôte local refusé.".to_string());
    }
    let addresses: Vec<SocketAddr> = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|_| "Résolution DNS impossible.".to_string())?
        .collect();
    if addresses.is_empty() || addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err("Adresse privée ou réservée refusée.".to_string());
    }
    Ok((host, addresses[0]))
}

/// GET sans suivi automatique des redirections : chaque saut est revalidé.
pub fn safe_get(
    url: &str,
    accept: &str,
    user_agent: &str,
    max_bytes: usize,
) -> Result<FetchedResource, String> {
    let mut current = Url::parse(url).map_err(|_| "Adresse invalide.".to_string())?;
    for _ in 0..=MAX_REDIRECTS {
        let (host, address) = validate_target(&current)?;
        let mut builder = Client::builder()
            .redirect(Policy::none())
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .user_agent(user_agent)
            .no_proxy();
        if host.parse::<IpAddr>().is_err() {
            builder = builder.resolve(&host, address);
        }
        let client = builder.build().map_err(|error| error.to_string())?;
        let response = client
            .get(current.clone())
            .header("Accept", accept)
            .send()
            .map_err(|_| "Requête impossible.".to_string())?;

        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "Redirection invalide.".to_string())?;
            current = current
                .join(location)
                .map_err(|_| "Redirection invalide.".to_string())?;
            continue;
        }
        if !response.status().is_success() {
            return Err("Réponse en erreur.".to_string());
        }
        if response
            .content_length()
            .is_some_and(|length| length as usize > max_bytes)
        {
            return Err("Ressource trop volumineuse.".to_string());
        }
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        let final_url = response.url().clone();
        let mut bytes = Vec::new();
        response
            .take(max_bytes as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Lecture impossible.".to_string())?;
        if bytes.len() > max_bytes {
            return Err("Ressource trop volumineuse.".to_string());
        }
        return Ok(FetchedResource {
            final_url,
            content_type,
            bytes,
        });
    }
    Err("Trop de redirections.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{is_public_ip, safe_get, validate_target};
    use url::Url;

    #[test]
    fn private_loopback_link_local_and_reserved_addresses_are_refused() {
        for blocked in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.4.2",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "255.255.255.255",
            "::1",
            "fe80::1",
            "fd00::1",
            "::ffff:127.0.0.1",
            "64:ff9b::a00:1",
        ] {
            assert!(!is_public_ip(blocked.parse().unwrap()), "{blocked}");
        }
        assert!(is_public_ip("1.1.1.1".parse().unwrap()));
        assert!(is_public_ip("2606:4700:4700::1111".parse().unwrap()));
    }

    #[test]
    fn unsafe_targets_are_rejected_before_any_connection() {
        for url in [
            "http://127.0.0.1/",
            "http://localhost/",
            "http://[::1]/",
            "http://169.254.169.254/latest/meta-data/",
            "http://192.168.0.10/",
            "https://example.com:8443/",
            "file:///etc/passwd",
            "ftp://example.com/",
            "https://user:pass@example.com/",
        ] {
            assert!(validate_target(&Url::parse(url).unwrap()).is_err(), "{url}");
        }
        assert!(safe_get("http://127.0.0.1:32191/v1/status", "*/*", "test", 1024).is_err());
    }
}
