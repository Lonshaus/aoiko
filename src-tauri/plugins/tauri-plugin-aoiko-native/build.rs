const COMMANDS: &[&str] = &[
    "pick_folder",
    "resolve_folder",
    "print_page",
    "open_in_app",
    "confirm_discard",
    "backup_open",
    "backup_write_chunk",
    "backup_close",
    "backup_read",
    "backup_list",
    "backup_remove",
    "export_open",
    "recognize_text",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
