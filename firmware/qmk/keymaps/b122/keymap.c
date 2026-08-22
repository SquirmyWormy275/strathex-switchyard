/*
 * QMK-compatible B122 reference transport.
 *
 * Adapt B122_LAYOUT(...) to the selected controller's matrix definition before
 * compiling. Firmware sends a Raw HID signal only; it does not invoke Windows,
 * VS Code, Git, terminals, agents, prompts, or network operations.
 */
#include QMK_KEYBOARD_H

enum b122_keycodes {
    B122_REANCHOR = SAFE_RANGE,
    B122_PROOF, B122_OPTION_PROVIDER, B122_PLAN_EXPANDER, B122_PLAN_APPROVAL,
    B122_HANDOFF, B122_FIND_BLOCKED, B122_FIND_FINISHED, B122_AUTHORITY_REFRESH, B122_COUNCIL,
    B122_CLAUDE, B122_CHATGPT, B122_VSCODE, B122_TERMINAL, B122_COMMIT, B122_GITHUB,
    B122_COMPOUND, B122_RUN, B122_VOICE, B122_PIPELINE, B122_SHIELD, B122_SANDBOX,
};

enum { B122_MARKER = 0xB1, B122_PROTOCOL_VERSION = 1 };
static uint16_t b122_sequence = 0;

static uint8_t b122_modifier_mask(void) {
    const uint8_t modifiers = get_mods() | get_oneshot_mods();
    const bool shift = modifiers & MOD_MASK_SHIFT;
    const bool alt = modifiers & MOD_MASK_ALT;
    const bool ctrl = modifiers & MOD_MASK_CTRL;
    return (ctrl ? 4 : 0) | (alt ? 2 : 0) | (shift ? 1 : 0);
}

static void send_b122_signal(uint8_t control) {
    uint8_t packet[RAW_EPSIZE] = {0};
    const uint16_t sequence = ++b122_sequence;
    packet[0] = B122_MARKER;
    packet[1] = B122_PROTOCOL_VERSION;
    packet[2] = control;
    packet[3] = b122_modifier_mask();
    packet[4] = sequence & 0xFF;
    packet[5] = sequence >> 8;
    packet[6] = packet[0] ^ packet[1] ^ packet[2] ^ packet[3] ^ packet[4] ^ packet[5];
    raw_hid_send(packet, RAW_EPSIZE);
}

bool process_record_user(uint16_t keycode, keyrecord_t *record) {
    if (keycode < B122_REANCHOR || keycode > B122_SANDBOX) return true;
    if (record->event.pressed) send_b122_signal((uint8_t)(keycode - B122_REANCHOR + 1));
    return false;
}

/*
 * Physical placement is intentionally not guessed. Define B122_LAYOUT with
 * the exact selected hardware matrix, then place the ten left-bank controls
 * and twelve upper-row controls in its physical order.
 */
#ifdef B122_LAYOUT
const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {
    [0] = B122_LAYOUT(
        B122_REANCHOR, B122_PROOF, B122_OPTION_PROVIDER, B122_PLAN_EXPANDER, B122_PLAN_APPROVAL,
        B122_HANDOFF, B122_FIND_BLOCKED, B122_FIND_FINISHED, B122_AUTHORITY_REFRESH, B122_COUNCIL,
        B122_CLAUDE, B122_CHATGPT, B122_VSCODE, B122_TERMINAL, B122_COMMIT, B122_GITHUB,
        B122_COMPOUND, B122_RUN, B122_VOICE, B122_PIPELINE, B122_SHIELD, B122_SANDBOX)
};
#endif
