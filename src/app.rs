use crate::dropdown::{Dropdown, DropdownOption};
use leptos::task::spawn_local;
use leptos::{ev::SubmitEvent, prelude::*};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = ["window", "__TAURI__", "core"])]
    async fn invoke(cmd: &str, args: JsValue) -> JsValue;
}

#[derive(Serialize, Deserialize)]
struct GreetArgs<'a> {
    name: &'a str,
}

#[component]
pub fn App() -> impl IntoView {
    let (selected_fruit, set_selected_fruit) = signal(String::new());
    let (selected_mode, set_selected_mode) = signal("dark".to_string());

    let fruit_options = vec![
        DropdownOption::new("apple", "Apple"),
        DropdownOption::new("banana", "Banana"),
        DropdownOption::new("cherry", "Cherry"),
        DropdownOption::new("durian", "Durian").disabled(),
        DropdownOption::new("elderberry", "Elderberry"),
    ];

    let mode_options = vec![
        DropdownOption::new("light", "Light"),
        DropdownOption::new("dark", "Dark"),
        DropdownOption::new("system", "System"),
    ];

    view! {
        <main class="container">

            <div class="flex flex-col items-center gap-4 mt-8 w-64 mx-auto">
                <Dropdown
                    value=Signal::derive(move || selected_fruit.get())
                    on_change=Callback::new(move |v| set_selected_fruit.set(v))
                    options=fruit_options
                    placeholder="Pick a fruit…".to_string()
                />
                <p class="text-sm">"Selected: " {move || selected_fruit.get()}</p>

                <div class="flex items-center gap-2 text-sm">
                    "Theme: "
                    <Dropdown
                        value=Signal::derive(move || selected_mode.get())
                        on_change=Callback::new(move |v| set_selected_mode.set(v))
                        options=mode_options
                        compact=true
                    />
                </div>
            </div>
        </main>
    }
}
