use std::ptr::{self, NonNull};

use objc2_core_foundation::{CFBoolean, CFData, CFDictionary, CFRetained, CFString, CFType};
use objc2_foundation::NSString;
use objc2_local_authentication::{LABiometryType, LAContext, LAPolicy};
use objc2_security::{
    errSecDuplicateItem, errSecItemNotFound, errSecSuccess, kSecAttrAccessControl,
    kSecAttrAccessibleWhenUnlockedThisDeviceOnly, kSecAttrAccount, kSecAttrService, kSecClass,
    kSecClassGenericPassword, kSecReturnAttributes, kSecReturnData, kSecUseAuthenticationContext,
    kSecUseAuthenticationUI, kSecUseAuthenticationUISkip, kSecUseDataProtectionKeychain,
    kSecValueData, SecAccessControl, SecAccessControlCreateFlags, SecItemAdd, SecItemCopyMatching,
    SecItemDelete,
};

use crate::{
    biometry_errors::{keychain_error_message, local_auth_error_message},
    BiometryUiStatus,
};

const KEYCHAIN_SERVICE: &str = "com.clave.desktop.biometry";
const KEYCHAIN_ACCOUNT: &str = "master-password";

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

fn base_query() -> CFRetained<CFDictionary> {
    let service = CFString::from_str(KEYCHAIN_SERVICE);
    let account = CFString::from_str(KEYCHAIN_ACCOUNT);
    dictionary(&[
        (
            unsafe { kSecClass }.as_ref(),
            unsafe { kSecClassGenericPassword }.as_ref(),
        ),
        (unsafe { kSecAttrService }.as_ref(), service.as_ref()),
        (unsafe { kSecAttrAccount }.as_ref(), account.as_ref()),
        (
            unsafe { kSecUseDataProtectionKeychain }.as_ref(),
            CFBoolean::new(true).as_ref(),
        ),
    ])
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

fn release_result(result: *const CFType) {
    if let Some(result) = NonNull::new(result.cast_mut()) {
        drop(unsafe { CFRetained::<CFType>::from_raw(result) });
    }
}

fn has_stored_password() -> Result<bool, String> {
    let service = CFString::from_str(KEYCHAIN_SERVICE);
    let account = CFString::from_str(KEYCHAIN_ACCOUNT);
    let query = dictionary(&[
        (
            unsafe { kSecClass }.as_ref(),
            unsafe { kSecClassGenericPassword }.as_ref(),
        ),
        (unsafe { kSecAttrService }.as_ref(), service.as_ref()),
        (unsafe { kSecAttrAccount }.as_ref(), account.as_ref()),
        (
            unsafe { kSecUseDataProtectionKeychain }.as_ref(),
            CFBoolean::new(true).as_ref(),
        ),
        (
            unsafe { kSecReturnAttributes }.as_ref(),
            CFBoolean::new(true).as_ref(),
        ),
        (
            unsafe { kSecUseAuthenticationUI }.as_ref(),
            unsafe { kSecUseAuthenticationUISkip }.as_ref(),
        ),
    ]);
    let mut result = ptr::null();
    let status = unsafe { SecItemCopyMatching(&query, &mut result) };
    release_result(result);

    if status == errSecSuccess {
        Ok(true)
    } else if status == errSecItemNotFound {
        Ok(false)
    } else {
        Err(keychain_error_message(status))
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

pub fn store_password(password: &str) -> Result<BiometryUiStatus, String> {
    touch_id_context()?;
    remove_password()?;

    let access_control = unsafe {
        SecAccessControl::with_flags(
            None,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly.as_ref(),
            SecAccessControlCreateFlags::BiometryCurrentSet,
            ptr::null_mut(),
        )
    }
    .ok_or_else(|| "La protection Touch ID n’a pas pu être créée.".to_string())?;

    let service = CFString::from_str(KEYCHAIN_SERVICE);
    let account = CFString::from_str(KEYCHAIN_ACCOUNT);
    let data = CFData::from_bytes(password.as_bytes());
    let attributes = dictionary(&[
        (
            unsafe { kSecClass }.as_ref(),
            unsafe { kSecClassGenericPassword }.as_ref(),
        ),
        (unsafe { kSecAttrService }.as_ref(), service.as_ref()),
        (unsafe { kSecAttrAccount }.as_ref(), account.as_ref()),
        (
            unsafe { kSecUseDataProtectionKeychain }.as_ref(),
            CFBoolean::new(true).as_ref(),
        ),
        (unsafe { kSecValueData }.as_ref(), data.as_ref()),
        (
            unsafe { kSecAttrAccessControl }.as_ref(),
            access_control.as_ref(),
        ),
    ]);
    let add_status = unsafe { SecItemAdd(&attributes, ptr::null_mut()) };
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
    let query = base_query();
    let result = unsafe { SecItemDelete(&query) };
    if result != errSecSuccess && result != errSecItemNotFound {
        return Err(keychain_error_message(result));
    }
    Ok(status())
}

pub fn load_password() -> Result<String, String> {
    let context = touch_id_context()?;
    let reason = NSString::from_str("déverrouiller votre coffre");
    let cancel = NSString::from_str("Utiliser le mot de passe");
    unsafe {
        context.setLocalizedReason(&reason);
        context.setLocalizedCancelTitle(Some(&cancel));
        context.setLocalizedFallbackTitle(Some(&cancel));
    }

    let service = CFString::from_str(KEYCHAIN_SERVICE);
    let account = CFString::from_str(KEYCHAIN_ACCOUNT);
    let query = dictionary(&[
        (
            unsafe { kSecClass }.as_ref(),
            unsafe { kSecClassGenericPassword }.as_ref(),
        ),
        (unsafe { kSecAttrService }.as_ref(), service.as_ref()),
        (unsafe { kSecAttrAccount }.as_ref(), account.as_ref()),
        (
            unsafe { kSecUseDataProtectionKeychain }.as_ref(),
            CFBoolean::new(true).as_ref(),
        ),
        (
            unsafe { kSecReturnData }.as_ref(),
            CFBoolean::new(true).as_ref(),
        ),
        (
            unsafe { kSecUseAuthenticationContext }.as_ref(),
            as_cf_type(&*context),
        ),
    ]);
    let mut result = ptr::null();
    let status = unsafe { SecItemCopyMatching(&query, &mut result) };
    if status != errSecSuccess {
        release_result(result);
        return Err(keychain_error_message(status));
    }

    let result = NonNull::new(result.cast_mut())
        .map(|result| unsafe { CFRetained::<CFType>::from_raw(result) })
        .ok_or_else(|| "Le Trousseau macOS n’a renvoyé aucun secret.".to_string())?;
    let data = result
        .downcast::<CFData>()
        .map_err(|_| "Le secret Touch ID stocké est invalide.".to_string())?;
    String::from_utf8(data.to_vec())
        .map_err(|_| "Le secret Touch ID stocké est invalide.".to_string())
}
