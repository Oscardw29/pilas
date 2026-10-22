/// App de escritorio de ¡Pilas! (Windows / Linux). Toda la lógica vive en la web empaquetada;
/// aquí solo se registran los plugins nativos que usa `src/platform/tauri.ts`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // fetch nativo (sin CORS) limitado por capabilities/default.json
    .plugin(tauri_plugin_http::init())
    // Notificaciones del sistema (centro de actividades de Windows, libnotify en Linux)
    .plugin(tauri_plugin_notification::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error al iniciar la aplicación");
}
