use std::ptr::{self, NonNull};
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_core_foundation::{CFBoolean, CFData, CFDictionary, CFRetained, CFString, CFType};
use objc2_foundation::{NSError, NSString};
use objc2_local_authentication::{LABiometryType, LAContext, LAPolicy};
use objc2_security::{
    errSecDuplicateItem, errSecItemNotFound, errSecSuccess, kSecAttrAccessControl,
    kSecAttrAccessibleWhenUnlockedThisDeviceOnly, kSecAttrAccount, kSecAttrLabel, kSecAttrService,
    kSecClass, kSecClassGenericPassword, kSecReturnAttributes, kSecReturnData,
    kSecUseAuthenticationContext, kSecUseAuthenticationUI, kSecUseAuthenticationUISkip,
    kSecUseDataProtectionKeychain, kSecValueData, SecAccessControl, SecAccessControlCreateFlags,
    SecItemAdd, SecItemCopyMatching, SecItemDelete,
};

use crate::{
    biometry_errors::{keychain_error_message, local_auth_error_message},
    BiometryUiStatus,
};

const KEYCHAIN_SERVICE: &str = "com.clave.desktop.biometry";
const KEYCHAIN_ACCOUNT: &str = "master-password";
const KEYCHAIN_LABEL: &str = "Clave - déverrouillage Touch ID";

/// errSecMissingEntitlement: the Data Protection keychain requires a
/// keychain-access-groups entitlement, which ad-hoc and Developer ID builds
/// without a provisioning profile do not have. Those builds fall back to the
/// login keychain, gated by an explicit Touch ID evaluation.
const ERR_SEC_MISSING_ENTITLEMENT: i32 = -34018;
/// errSecInteractionNotAllowed: returned for a biometry-protected item when
/// the authentication UI is skipped, which proves that the item exists.
const ERR_SEC_INTERACTION_NOT_ALLOWED: i32 = -25308;
/// errSecAuthFailed: the biometric access control no longer matches the
/// enrolled fingerprints.
const ERR_SEC_AUTH_FAILED: i32 = -25293;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Keychain {
    /// Data Protection keychain, item protected by a biometric access control.
    DataProtection,
    /// Legacy login keychain, read only after a successful Touch ID evaluation.
    Login,
}

const KEYCHAINS: [Keychain; 2] = [Keychain::DataProtection, Keychain::Login];

fn as_cf_type<T>(value: &T) -> &CFType {
    // Keychain dictionaries accept Core Foundation and Objective-C objects.
    unsafe { &*(ptr::from_ref(value).cast::<CFType>()) }
}

fn dictionary(pairs: &[(&CFType, &CFType)]) -> CFRetained<CFDictionary> {
    let keys: Vec<&CFType> = pairs.iter().map(|(key, _)| *key).collect();
    let values: Vec<&CFType> = pairs.iter().map(|(_, value)| *value).collect();
    let dictionary = CFDictionary::from_slices(&keys, &values);
    // SecItem accepts a heterogeneous CFDictionary; the typed builder above
    // guarantees that every key and value is a retained Core Foundation type.
    unsafe { CFRetained::cast_unchecked(dictionary) }
}

/// Keychain query for the stored master password, extended with `extra`.
fn query(keychain: Keychain, extra: &[(&CFType, &CFType)]) -> CFRetained<CFDictionary> {
    let service = CFString::from_str(KEYCHAIN_SERVICE);
    let account = CFString::from_str(KEYCHAIN_ACCOUNT);
    let use_data_protection = CFBoolean::new(keychain == Keychain::DataProtection);
    let mut pairs: Vec<(&CFType, &CFType)> = vec![
        (
            unsafe { kSecClass }.as_ref(),
            unsafe { kSecClassGenericPassword }.as_ref(),
        ),
        (unsafe { kSecAttrService }.as_ref(), service.as_ref()),
        (unsafe { kSecAttrAccount }.as_ref(), account.as_ref()),
        (
            unsafe { kSecUseDataProtectionKeychain }.as_ref(),
            use_data_protection.as_ref(),
        ),
    ];
    pairs.extend_from_slice(extra);
    dictionary(&pairs)
}

fn touch_id_context() -> Result<objc2::rc::Retained<LAContext>, String> {
    let context = unsafe { LAContext::new() };
    if let Err(error) = unsafe {
        context.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
    } {
        return Err(local_auth_error_message(error.code()));
    }

    if unsafe { context.biometryType() } != LABiometryType::TouchID {
        return Err(
            "Touch ID n’est pas disponible sur ce Mac. Utilisez votre mot de passe maître."
                .to_string(),
        );
    }

    Ok(context)
}

/// Shows the Touch ID prompt and blocks until the user answers. LocalAuthentication
/// replies on a private queue, so this must run off the main thread.
fn evaluate_touch_id(context: &LAContext) -> Result<(), String> {
    let (sender, receiver) = mpsc::channel::<Result<(), isize>>();
    let reply = RcBlock::new(move |success: Bool, error: *mut NSError| {
        let result = if success.as_bool() {
            Ok(())
        } else {
            Err(unsafe { error.as_ref() }.map_or(-1, |error| error.code()))
        };
        let _ = sender.send(result);
    });
    let reason = NSString::from_str("déverrouiller votre coffre");
    unsafe {
        context.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
            &reason,
            &reply,
        );
    }

    match receiver.recv_timeout(Duration::from_secs(120)) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(code)) => Err(local_auth_error_message(code)),
        Err(_) => {
            // Dismisses the prompt left on screen, which would otherwise keep
            // waiting for a fingerprint nobody listens for.
            unsafe { context.invalidate() };
            Err(local_auth_error_message(-4))
        }
    }
}

fn release_result(result: *const CFType) {
    if let Some(result) = NonNull::new(result.cast_mut()) {
        drop(unsafe { CFRetained::<CFType>::from_raw(result) });
    }
}

fn has_item(keychain: Keychain) -> Result<bool, i32> {
    let query = query(
        keychain,
        &[
            (
                unsafe { kSecReturnAttributes }.as_ref(),
                CFBoolean::new(true).as_ref(),
            ),
            (
                unsafe { kSecUseAuthenticationUI }.as_ref(),
                unsafe { kSecUseAuthenticationUISkip }.as_ref(),
            ),
        ],
    );
    let mut result = ptr::null();
    let status = unsafe { SecItemCopyMatching(&query, &mut result) };
    release_result(result);

    if status == errSecSuccess || status == ERR_SEC_INTERACTION_NOT_ALLOWED {
        Ok(true)
    } else if status == errSecItemNotFound || status == ERR_SEC_MISSING_ENTITLEMENT {
        Ok(false)
    } else {
        Err(status)
    }
}

fn has_stored_password() -> Result<bool, String> {
    let mut last_error = None;
    for keychain in KEYCHAINS {
        match has_item(keychain) {
            Ok(true) => return Ok(true),
            Ok(false) => {}
            Err(status) => last_error = Some(status),
        }
    }
    match last_error {
        Some(status) => Err(keychain_error_message(status)),
        None => Ok(false),
    }
}

pub fn status() -> BiometryUiStatus {
    let stored_password = has_stored_password();
    match (touch_id_context(), stored_password) {
        (Ok(_), Ok(is_enabled)) => BiometryUiStatus {
            is_available: true,
            is_enabled,
            biometry_type: "TouchID".to_string(),
            error: None,
        },
        (Ok(_), Err(error)) => BiometryUiStatus {
            is_available: true,
            is_enabled: false,
            biometry_type: "TouchID".to_string(),
            error: Some(error),
        },
        (Err(error), Ok(is_enabled)) => BiometryUiStatus {
            is_available: false,
            is_enabled,
            biometry_type: "None".to_string(),
            error: Some(error),
        },
        (Err(error), Err(keychain_error)) => BiometryUiStatus {
            is_available: false,
            is_enabled: false,
            biometry_type: "None".to_string(),
            error: Some(format!("{error} {keychain_error}")),
        },
    }
}

pub fn is_enabled() -> bool {
    has_stored_password().unwrap_or(false)
}

fn add_item(keychain: Keychain, password: &str) -> i32 {
    let data = CFData::from_bytes(password.as_bytes());
    let label = CFString::from_str(KEYCHAIN_LABEL);
    let access_control = match keychain {
        Keychain::DataProtection => {
            let access_control = unsafe {
                SecAccessControl::with_flags(
                    None,
                    kSecAttrAccessibleWhenUnlockedThisDeviceOnly.as_ref(),
                    SecAccessControlCreateFlags::BiometryCurrentSet,
                    ptr::null_mut(),
                )
            };
            match access_control {
                Some(access_control) => Some(access_control),
                None => return ERR_SEC_MISSING_ENTITLEMENT,
            }
        }
        Keychain::Login => None,
    };

    let mut extra: Vec<(&CFType, &CFType)> = vec![
        (unsafe { kSecValueData }.as_ref(), data.as_ref()),
        (unsafe { kSecAttrLabel }.as_ref(), label.as_ref()),
    ];
    if let Some(access_control) = access_control.as_ref() {
        extra.push((
            unsafe { kSecAttrAccessControl }.as_ref(),
            access_control.as_ref(),
        ));
    }

    let attributes = query(keychain, &extra);
    unsafe { SecItemAdd(&attributes, ptr::null_mut()) }
}

pub fn store_password(password: &str) -> Result<BiometryUiStatus, String> {
    touch_id_context()?;
    remove_password()?;

    let mut add_status = add_item(Keychain::DataProtection, password);
    if add_status != errSecSuccess && add_status != errSecDuplicateItem {
        add_status = add_item(Keychain::Login, password);
    }
    if add_status != errSecSuccess {
        return Err(if add_status == errSecDuplicateItem {
            "Touch ID est déjà activé pour Clave.".to_string()
        } else {
            keychain_error_message(add_status)
        });
    }

    Ok(status())
}

pub fn remove_password() -> Result<BiometryUiStatus, String> {
    for keychain in KEYCHAINS {
        let result = unsafe { SecItemDelete(&query(keychain, &[])) };
        if result != errSecSuccess
            && result != errSecItemNotFound
            && result != ERR_SEC_MISSING_ENTITLEMENT
        {
            return Err(keychain_error_message(result));
        }
    }
    Ok(status())
}

fn copy_password(keychain: Keychain, context: &LAContext) -> Result<String, i32> {
    let query = query(
        keychain,
        &[
            (
                unsafe { kSecReturnData }.as_ref(),
                CFBoolean::new(true).as_ref(),
            ),
            (
                unsafe { kSecUseAuthenticationContext }.as_ref(),
                as_cf_type(context),
            ),
        ],
    );
    let mut result = ptr::null();
    let status = unsafe { SecItemCopyMatching(&query, &mut result) };
    if status != errSecSuccess {
        release_result(result);
        return Err(status);
    }

    let result = NonNull::new(result.cast_mut())
        .map(|result| unsafe { CFRetained::<CFType>::from_raw(result) })
        .ok_or(errSecItemNotFound)?;
    let data = result.downcast::<CFData>().map_err(|_| errSecItemNotFound)?;
    String::from_utf8(data.to_vec()).map_err(|_| errSecItemNotFound)
}

pub fn load_password() -> Result<String, String> {
    if !has_stored_password()? {
        return Err(keychain_error_message(errSecItemNotFound));
    }

    let context = touch_id_context()?;
    let cancel = NSString::from_str("Utiliser le mot de passe");
    unsafe {
        context.setLocalizedCancelTitle(Some(&cancel));
        context.setLocalizedFallbackTitle(Some(&cancel));
    }
    // One prompt for both keychains: the evaluated context is reused by the
    // biometric access control of the Data Protection item.
    evaluate_touch_id(&context)?;

    let mut last_status = errSecItemNotFound;
    for keychain in KEYCHAINS {
        match copy_password(keychain, &context) {
            Ok(password) => return Ok(password),
            // Not found in this keychain: keep the status of the other one.
            Err(status) if status == errSecItemNotFound => {}
            Err(status) => last_status = status,
        }
    }

    // Touch ID succeeded but the secret is unreadable: a BiometryCurrentSet item is
    // invalidated for good when fingerprints change. Remove it so the interface
    // offers to enable Touch ID again instead of failing on every unlock. A
    // cancelled keychain prompt (-128) keeps the secret.
    if last_status == ERR_SEC_AUTH_FAILED {
        let _ = remove_password();
        return Err("Le secret Touch ID n’est plus valide (empreintes modifiées ?). Déverrouillez avec votre mot de passe maître, puis réactivez Touch ID dans les réglages.".to_string());
    }
    Err(keychain_error_message(last_status))
}
