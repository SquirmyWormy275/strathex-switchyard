#include "b122_protocol.h"

#include <string.h>

#include "../qmk/keymaps/b122/b122_manifest.h"

static const uint8_t b122_fingerprint[8] = B122_MAP_FINGERPRINT_BYTES;

static uint32_t read_u32(const uint8_t *bytes) {
    return ((uint32_t)bytes[0]) | ((uint32_t)bytes[1] << 8) | ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

static void write_u32(uint8_t *bytes, uint32_t value) {
    bytes[0] = (uint8_t)value; bytes[1] = (uint8_t)(value >> 8); bytes[2] = (uint8_t)(value >> 16); bytes[3] = (uint8_t)(value >> 24);
}

uint32_t b122_crc32(const uint8_t *bytes, size_t length) {
    uint32_t crc = 0xFFFFFFFFu;
    size_t index;
    for (index = 0; index < length; ++index) {
        uint8_t bit;
        crc ^= bytes[index];
        for (bit = 0; bit < 8; ++bit) crc = (crc >> 1) ^ ((crc & 1u) ? 0xEDB88320u : 0u);
    }
    return crc ^ 0xFFFFFFFFu;
}

bool b122_frame_valid(const uint8_t frame[B122_FRAME_SIZE]) {
    if (!frame || frame[0] != 0xB1u || frame[1] != 0x22u || frame[2] != 1u || frame[3] < B122_HELLO || frame[3] > B122_STATUS) return false;
    if (frame[4] != 0u || frame[5] != 12u || frame[6] != 0u || frame[7] != 0u) return false;
    if (read_u32(&frame[28]) != b122_crc32(frame, 28u)) return false;
    if (frame[3] == B122_SIGNAL && (frame[22] > 1u || frame[23] != 0u || frame[24] != 0u || frame[25] != 0u || frame[26] != 0u || frame[27] != 0u)) return false;
    if (frame[3] == B122_ACK && (frame[24] > B122_ACK_DUPLICATE || frame[25] != 0u || frame[26] != 0u || frame[27] != 0u)) return false;
    if (frame[3] == B122_NACK && (frame[24] < 1u || frame[24] > 6u || frame[25] != 0u || frame[26] != 0u || frame[27] != 0u)) return false;
    if (frame[3] == B122_STATUS && (frame[22] != 0u || frame[23] != 0u || frame[20] > B122_STATUS_DEGRADED)) return false;
    return true;
}

uint32_t b122_frame_counter(const uint8_t frame[B122_FRAME_SIZE]) { return read_u32(&frame[12]); }
uint8_t b122_frame_type(const uint8_t frame[B122_FRAME_SIZE]) { return frame[3]; }

static void begin_frame(const b122_device_protocol_t *state, uint32_t counter, uint8_t type, uint8_t frame[B122_FRAME_SIZE]) {
    memset(frame, 0, B122_FRAME_SIZE);
    frame[0] = 0xB1u; frame[1] = 0x22u; frame[2] = 1u; frame[3] = type; frame[5] = 12u;
    write_u32(&frame[8], state->connection_epoch); write_u32(&frame[12], counter); write_u32(&frame[16], state->boot_nonce);
}

static void finish_frame(uint8_t frame[B122_FRAME_SIZE]) { write_u32(&frame[28], b122_crc32(frame, 28u)); }

static b122_pending_frame_t *free_pending(b122_device_protocol_t *state) {
    uint8_t index;
    for (index = 0; index < B122_MAX_PENDING; ++index) if (!state->pending[index].occupied) return &state->pending[index];
    return NULL;
}

static bool queue_frame(b122_device_protocol_t *state, uint8_t type, uint32_t now_ms, uint8_t out[B122_FRAME_SIZE], b122_pending_frame_t **slot) {
    b122_pending_frame_t *pending = free_pending(state);
    if (!pending || state->device_counter == 0xFFFFFFFFu) return false;
    ++state->device_counter;
    begin_frame(state, state->device_counter, type, out);
    pending->occupied = true; pending->sent_at_ms = now_ms; pending->retries = 0u;
    *slot = pending;
    return true;
}

static void persist_frame(b122_pending_frame_t *pending, uint8_t frame[B122_FRAME_SIZE]) {
    finish_frame(frame);
    memcpy(pending->bytes, frame, B122_FRAME_SIZE);
}

void b122_device_init(b122_device_protocol_t *state, uint32_t epoch, uint32_t boot_nonce) {
    memset(state, 0, sizeof(*state));
    state->connection_epoch = epoch; state->boot_nonce = boot_nonce;
}

bool b122_device_hello(b122_device_protocol_t *state, uint32_t now_ms, uint8_t out[B122_FRAME_SIZE]) {
    b122_pending_frame_t *pending;
    if (!queue_frame(state, B122_HELLO, now_ms, out, &pending)) return false;
    memcpy(&out[20], b122_fingerprint, sizeof(b122_fingerprint));
    persist_frame(pending, out);
    return true;
}

bool b122_device_signal(b122_device_protocol_t *state, uint8_t control_id, uint8_t modifier_mask, uint32_t now_ms, uint8_t out[B122_FRAME_SIZE]) {
    b122_pending_frame_t *pending;
    if (!state->handshake_complete || control_id == 0u || control_id > B122_CONTROL_COUNT || modifier_mask > 7u) return false;
    if (!queue_frame(state, B122_SIGNAL, now_ms, out, &pending)) return false;
    out[20] = control_id; out[21] = modifier_mask;
    out[22] = (b122_assignment_masks[control_id] & (1u << modifier_mask)) ? 1u : 0u;
    persist_frame(pending, out);
    return true;
}

bool b122_device_status(b122_device_protocol_t *state, enum b122_device_status status, uint32_t now_ms, uint8_t out[B122_FRAME_SIZE]) {
    b122_pending_frame_t *pending;
    uint8_t count = 0u, index;
    if (!state->handshake_complete || status > B122_STATUS_DEGRADED || !queue_frame(state, B122_STATUS, now_ms, out, &pending)) return false;
    for (index = 0; index < B122_MAX_PENDING; ++index) if (state->pending[index].occupied && b122_frame_type(state->pending[index].bytes) == B122_SIGNAL) ++count;
    out[20] = (uint8_t)status; out[21] = count; write_u32(&out[24], state->last_acknowledged_counter);
    persist_frame(pending, out);
    return true;
}

static bool same_session(const b122_device_protocol_t *state, const uint8_t *frame) {
    return read_u32(&frame[8]) == state->connection_epoch && read_u32(&frame[16]) == state->boot_nonce;
}

static bool clear_pending(b122_device_protocol_t *state, uint32_t counter) {
    uint8_t index;
    for (index = 0; index < B122_MAX_PENDING; ++index) {
        if (state->pending[index].occupied && b122_frame_counter(state->pending[index].bytes) == counter) {
            state->pending[index].occupied = false;
            return true;
        }
    }
    return false;
}

bool b122_device_receive(b122_device_protocol_t *state, const uint8_t frame[B122_FRAME_SIZE]) {
    uint32_t host_counter, acknowledged;
    if (!b122_frame_valid(frame) || !same_session(state, frame)) return false;
    host_counter = b122_frame_counter(frame);
    if (host_counter <= state->host_counter) return false;
    if (frame[3] == B122_HELLO_ACK) {
        uint8_t index;
        if (memcmp(&frame[20], b122_fingerprint, sizeof(b122_fingerprint)) != 0) return false;
        state->host_counter = host_counter;
        state->handshake_complete = true;
        for (index = 0; index < B122_MAX_PENDING; ++index) if (state->pending[index].occupied && b122_frame_type(state->pending[index].bytes) == B122_HELLO) state->pending[index].occupied = false;
        return true;
    }
    if (frame[3] == B122_ACK) {
        acknowledged = read_u32(&frame[20]);
        if (!clear_pending(state, acknowledged)) return false;
        state->host_counter = host_counter;
        if (acknowledged > state->last_acknowledged_counter) state->last_acknowledged_counter = acknowledged;
        return true;
    }
    if (frame[3] == B122_NACK) { state->host_counter = host_counter; return true; }
    return false;
}

size_t b122_device_retries(b122_device_protocol_t *state, uint32_t now_ms, uint32_t retry_after_ms, uint8_t max_retries, uint8_t (*out)[B122_FRAME_SIZE], size_t capacity) {
    size_t count = 0u;
    uint8_t index;
    for (index = 0; index < B122_MAX_PENDING && count < capacity; ++index) {
        b122_pending_frame_t *pending = &state->pending[index];
        if (!pending->occupied || (uint32_t)(now_ms - pending->sent_at_ms) < retry_after_ms) continue;
        if (pending->retries >= max_retries) { pending->occupied = false; state->degraded = true; continue; }
        memcpy(out[count++], pending->bytes, B122_FRAME_SIZE);
        pending->sent_at_ms = now_ms; ++pending->retries;
    }
    return count;
}

bool b122_device_has_pending(const b122_device_protocol_t *state) {
    uint8_t index;
    for (index = 0; index < B122_MAX_PENDING; ++index) if (state->pending[index].occupied) return true;
    return false;
}

bool b122_device_take_degraded(b122_device_protocol_t *state) {
    const bool degraded = state->degraded;
    state->degraded = false;
    return degraded;
}
