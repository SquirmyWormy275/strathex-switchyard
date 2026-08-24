/* SXSY-B122 signal-only QMK keymap overlay. */
#include QMK_KEYBOARD_H
#include "raw_hid.h"
#include "b122_manifest.h"
#include "b122_protocol.h"

#if RAW_EPSIZE != B122_FRAME_SIZE
#    error "B122 requires an exact 32-byte QMK Raw-HID report."
#endif

enum b122_keycodes {
    B122_REANCHOR = SAFE_RANGE,
    B122_PROOF, B122_OPTION_PROVIDER, B122_PLAN_EXPANDER, B122_PLAN_APPROVAL,
    B122_HANDOFF, B122_FIND_BLOCKED, B122_FIND_FINISHED, B122_AUTHORITY_REFRESH, B122_COUNCIL,
    B122_CLAUDE, B122_CHATGPT, B122_VSCODE, B122_TERMINAL, B122_COMMIT, B122_GITHUB,
    B122_COMPOUND, B122_RUN, B122_VOICE, B122_PIPELINE, B122_SHIELD, B122_SANDBOX,
};

static b122_device_protocol_t b122_protocol;
static bool b122_initialized;

__attribute__((weak)) void b122_status_changed_user(enum b122_device_status status) { (void)status; }

static uint8_t b122_modifier_mask(void) {
    const uint8_t modifiers = get_mods() | get_oneshot_mods();
    return ((modifiers & MOD_MASK_CTRL) ? 4u : 0u) | ((modifiers & MOD_MASK_ALT) ? 2u : 0u) | ((modifiers & MOD_MASK_SHIFT) ? 1u : 0u);
}

static void b122_send(const uint8_t frame[B122_FRAME_SIZE]) { raw_hid_send((uint8_t *)frame, B122_FRAME_SIZE); }

void eeconfig_init_user(void) { eeconfig_update_user(0u); }

void keyboard_post_init_user(void) {
    uint8_t hello[B122_FRAME_SIZE];
    uint32_t epoch = eeconfig_read_user() + 1u;
    if (epoch == 0u) epoch = 1u;
    eeconfig_update_user(epoch);
    b122_device_init(&b122_protocol, epoch, timer_read32() ^ epoch ^ 0xB1225A17u);
    b122_initialized = true;
    if (b122_device_hello(&b122_protocol, timer_read32(), hello)) b122_send(hello);
    b122_status_changed_user(B122_STATUS_BOOTING);
}

void raw_hid_receive(uint8_t *data, uint8_t length) {
    if (!b122_initialized || length != B122_FRAME_SIZE) return;
    if (b122_device_receive(&b122_protocol, data) && b122_protocol.handshake_complete) b122_status_changed_user(B122_STATUS_READY);
}

void housekeeping_task_user(void) {
    uint8_t retries[B122_MAX_PENDING][B122_FRAME_SIZE];
    size_t index, count;
    if (!b122_initialized) return;
    count = b122_device_retries(&b122_protocol, timer_read32(), 250u, 3u, retries, B122_MAX_PENDING);
    for (index = 0; index < count; ++index) b122_send(retries[index]);
    if (b122_device_take_degraded(&b122_protocol)) b122_status_changed_user(B122_STATUS_DEGRADED);
    if (!b122_protocol.handshake_complete && !b122_device_has_pending(&b122_protocol)) {
        uint8_t hello[B122_FRAME_SIZE];
        if (b122_device_hello(&b122_protocol, timer_read32(), hello)) b122_send(hello);
        b122_status_changed_user(B122_STATUS_DEGRADED);
    }
}

bool process_record_user(uint16_t keycode, keyrecord_t *record) {
    uint8_t frame[B122_FRAME_SIZE];
    if (keycode < B122_REANCHOR || keycode > B122_SANDBOX) return true;
    if (record->event.pressed && b122_device_signal(&b122_protocol, (uint8_t)(keycode - B122_REANCHOR + 1u), b122_modifier_mask(), timer_read32(), frame)) b122_send(frame);
    return false;
}

/* Physical placement is an explicit integration seam until the exact matrix is inspected. */
#ifdef B122_LAYOUT
const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {
    [0] = B122_LAYOUT(
        B122_REANCHOR, B122_PROOF, B122_OPTION_PROVIDER, B122_PLAN_EXPANDER, B122_PLAN_APPROVAL,
        B122_HANDOFF, B122_FIND_BLOCKED, B122_FIND_FINISHED, B122_AUTHORITY_REFRESH, B122_COUNCIL,
        B122_CLAUDE, B122_CHATGPT, B122_VSCODE, B122_TERMINAL, B122_COMMIT, B122_GITHUB,
        B122_COMPOUND, B122_RUN, B122_VOICE, B122_PIPELINE, B122_SHIELD, B122_SANDBOX)
};
#endif
