pub fn local_auth_error_message(code: isize) -> String {
    match code {
        -1 => "Touch ID n’a pas reconnu votre empreinte. Réessayez ou utilisez votre mot de passe maître.",
        -2 => "Authentification Touch ID annulée. Utilisez votre mot de passe maître.",
        -3 => "Utilisez votre mot de passe maître pour déverrouiller Clave.",
        -4 | -9 => "L’authentification Touch ID a été interrompue. Réessayez ou utilisez votre mot de passe maître.",
        -5 => "Un mot de passe de session macOS est requis pour utiliser Touch ID.",
        -6 => "Touch ID n’est pas disponible sur ce Mac. Utilisez votre mot de passe maître.",
        -7 => "Aucune empreinte Touch ID n’est configurée. Utilisez votre mot de passe maître.",
        -8 => "Touch ID est verrouillé. Déverrouillez votre Mac, puis réessayez ou utilisez votre mot de passe maître.",
        _ => "L’authentification Touch ID a échoué. Utilisez votre mot de passe maître.",
    }
    .to_string()
}

pub fn keychain_error_message(status: i32) -> String {
    match status {
        -128 => "Authentification Touch ID annulée. Utilisez votre mot de passe maître.",
        -25293 => "Touch ID n’a pas pu autoriser l’accès. Utilisez votre mot de passe maître.",
        -25300 => "Touch ID n’est pas activé pour Clave. Utilisez votre mot de passe maître.",
        -25308 | -25315 => {
            "L’authentification Touch ID est requise. Réessayez depuis la fenêtre Clave."
        }
        _ => "Le secret Touch ID n’est pas accessible. Utilisez votre mot de passe maître.",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::{keychain_error_message, local_auth_error_message};

    #[test]
    fn local_auth_cancellation_returns_to_the_master_password() {
        assert_eq!(
            local_auth_error_message(-2),
            "Authentification Touch ID annulée. Utilisez votre mot de passe maître."
        );
        assert_eq!(
            local_auth_error_message(-3),
            "Utilisez votre mot de passe maître pour déverrouiller Clave."
        );
    }

    #[test]
    fn local_auth_unavailability_explains_the_available_fallback() {
        assert_eq!(
            local_auth_error_message(-6),
            "Touch ID n’est pas disponible sur ce Mac. Utilisez votre mot de passe maître."
        );
        assert_eq!(
            local_auth_error_message(-7),
            "Aucune empreinte Touch ID n’est configurée. Utilisez votre mot de passe maître."
        );
        assert_eq!(
            local_auth_error_message(-8),
            "Touch ID est verrouillé. Déverrouillez votre Mac, puis réessayez ou utilisez votre mot de passe maître."
        );
    }

    #[test]
    fn missing_keychain_secret_disables_biometric_unlock() {
        assert_eq!(
            keychain_error_message(-25300),
            "Touch ID n’est pas activé pour Clave. Utilisez votre mot de passe maître."
        );
    }
}
