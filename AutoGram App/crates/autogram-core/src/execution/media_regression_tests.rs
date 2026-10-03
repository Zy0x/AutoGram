//! Isolated real-tool regression. No personal input, credentials or cloud writes.
use super::{output_contract::{validate_output_contract, OutputContract}, transcode_with_profile};
use crate::platform::{find_ffmpeg_binary, find_ffprobe_binary, media_process::run_media_command, EncoderQualityProfile};
use std::{fs, process::Command, time::Duration};
use crate::platform::{DesktopEncoderProvider, EncoderProvider};

struct Fixture(std::path::PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

#[test]
fn real_transcode_requires_decodable_output_and_preserves_existing_destination() {
    let Some(tool) = find_ffmpeg_binary() else {
        assert!(crate::platform::encoder_probe::verified_encoder_capability().primary_encoder.is_empty());
        eprintln!("real media tool unavailable: output regression not exercised");
        return;
    };
    if find_ffprobe_binary().is_none() {
        eprintln!("real ffprobe unavailable: output regression not exercised");
        return;
    }
    let fixture = Fixture(std::env::temp_dir().join(format!("autogram-media-regression-{}", rand::random::<u64>())));
    fs::create_dir(&fixture.0).unwrap();
    let input = fixture.0.join("input.mp4");
    let output = fixture.0.join("output.mp4");
    let mut generate = Command::new(&tool);
    generate.args(["-nostdin", "-loglevel", "error", "-n", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=10",
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"]).arg(&input);
    assert!(run_media_command(generate, Duration::from_secs(20)).unwrap().status.success());
    let profile = EncoderQualityProfile::Balanced { bitrate: 100_000, preset: "ultrafast".into() };
    let receipt = transcode_with_profile(&input, &output, &profile, "libx264").unwrap();
    assert!(receipt.validation_passed);
    assert!(fs::metadata(&output).unwrap().len() > 0);
    let contract = OutputContract { require_audio_stream: true, ..Default::default() };
    validate_output_contract(&output, &contract).unwrap();
    let mut decode = Command::new(&tool);
    decode.args(["-nostdin", "-v", "error", "-i"]).arg(&output).args(["-f", "null", "-"]);
    assert!(run_media_command(decode, Duration::from_secs(20)).unwrap().status.success());
    let provider_output = fixture.0.join("provider.mp4");
    DesktopEncoderProvider::new().encode(&input, &provider_output, &EncoderQualityProfile::default()).unwrap();
    validate_output_contract(&provider_output, &contract).unwrap();
    let preserved = fs::read(&output).unwrap();
    assert_eq!(transcode_with_profile(&input, &output, &profile, "libx264").unwrap_err(), "media_destination_exists");
    assert_eq!(fs::read(&output).unwrap(), preserved);
    let fake = fixture.0.join("fake.mp4");
    fs::write(&fake, b"nonempty is not a valid media output").unwrap();
    assert!(validate_output_contract(&fake, &contract).is_err());
    assert!(validate_output_contract(&output, &OutputContract { max_size_bytes: 1, ..contract }).is_err());
}
