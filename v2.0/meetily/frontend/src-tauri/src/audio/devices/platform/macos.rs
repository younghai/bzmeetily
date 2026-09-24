use anyhow::Result;
use cidre::core_audio::hardware::System;

use crate::audio::devices::configuration::{AudioDevice, DeviceType};

fn should_include_output_device(name: &str) -> bool {
    !name.to_lowercase().contains("speakers")
}

fn append_device_directions(
    devices: &mut Vec<AudioDevice>,
    name: String,
    has_input: bool,
    has_output: bool,
) {
    if has_input {
        devices.push(AudioDevice::new(name.clone(), DeviceType::Input));
    }
    if has_output && should_include_output_device(&name) {
        devices.push(AudioDevice::new(name, DeviceType::Output));
    }
}

/// Configure macOS audio devices using ScreenCaptureKit and CoreAudio
pub fn configure_macos_audio(_host: &cpal::Host) -> Result<Vec<AudioDevice>> {
    let mut devices: Vec<AudioDevice> = Vec::new();

    for device in System::devices()? {
        let Ok(name) = device.name() else {
            continue;
        };
        let has_input = device.input_stream_cfg().is_ok_and(|config| {
            config
                .buffers()
                .iter()
                .take(config.number_buffers())
                .any(|buffer| buffer.number_channels > 0)
        });
        let has_output = device.output_stream_cfg().is_ok_and(|config| {
            config
                .buffers()
                .iter()
                .take(config.number_buffers())
                .any(|buffer| buffer.number_channels > 0)
        });

        append_device_directions(&mut devices, name.to_string(), has_input, has_output);
    }

    Ok(devices)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_duplex_device_in_both_directions() {
        let mut devices = Vec::new();
        append_device_directions(&mut devices, "USB Headset".to_string(), true, true);

        assert!(
            devices.iter().any(|device| device.device_type == DeviceType::Input),
            "expected an input entry"
        );
        assert!(
            devices.iter().any(|device| device.device_type == DeviceType::Output),
            "expected an output entry"
        );
    }
}
