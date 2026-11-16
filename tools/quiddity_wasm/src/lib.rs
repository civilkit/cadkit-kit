//! Browser entry point for quiddity: `recognise(stepBytes)` returns the recognition document as JSON text.
//! No file system: the bytes are read in memory, like `quiddity::file_api::recognise_bytes`.
use wasm_bindgen::prelude::*;

/// Recognise the manufacturing features in a STEP file's bytes. Returns the JSON document (schema `recognition/6`) or throws a string.
#[wasm_bindgen]
pub fn recognise(step: Vec<u8>) -> Result<String, JsError> {
    quiddity::file_api::recognise_bytes(step).map_err(|e| JsError::new(&e))
}

/// The quiddity version this build wraps, for the licences page and the saved result.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
