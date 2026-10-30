package com.pocketpal

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.pocketpal.specs.NativeAudioRecorderSpec
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile

/**
 * 原生录音：AudioRecord 采 16bit mono PCM，写成 WAV 文件。
 *
 * WAV 是 RVC / 变声服务端最通用的输入（librosa / soundfile 直接读），
 * 录音后无需转码即可上传做变声或本地回放。
 */
@ReactModule(name = NativeAudioRecorderSpec.NAME)
class AudioRecorderModule(reactContext: ReactApplicationContext) :
    NativeAudioRecorderSpec(reactContext) {

  private var audioRecord: AudioRecord? = null
  private var recordThread: Thread? = null
  private var outputFile: File? = null
  private var dataSize = 0L
  private var chosenSampleRate = 16000

  @Volatile
  private var recording = false

  override fun getName(): String = NativeAudioRecorderSpec.NAME

  override fun startRecording(outputPath: String, sampleRate: Double, promise: Promise) {
    if (recording) {
      promise.resolve(false)
      return
    }
    val rate = sampleRate.toInt()
    val validRates = intArrayOf(8000, 16000, 22050, 24000, 32000, 44100, 48000)
    val chosen = if (validRates.contains(rate)) rate else 16000
    chosenSampleRate = chosen

    try {
      val minBuf = AudioRecord.getMinBufferSize(
        chosen,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
      if (minBuf <= 0) {
        promise.reject("RECORDER_ERROR", "getMinBufferSize failed")
        return
      }
      val rec = AudioRecord(
        MediaRecorder.AudioSource.MIC,
        chosen,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        minBuf * 2,
      )
      if (rec.state != AudioRecord.STATE_INITIALIZED) {
        rec.release()
        promise.reject("RECORDER_ERROR", "AudioRecord init failed")
        return
      }

      val file = File(outputPath)
      file.parentFile?.mkdirs()
      // 先写 44 字节占位头，录完回填
      FileOutputStream(file).use { it.write(ByteArray(44)) }

      val buffer = ByteArray(minBuf * 2)
      val out = BufferedOutputStream(FileOutputStream(file, true))
      dataSize = 0
      outputFile = file
      audioRecord = rec

      rec.startRecording()
      recording = true

      recordThread = Thread {
        try {
          while (recording) {
            val read = rec.read(buffer, 0, buffer.size)
            if (read > 0) {
              out.write(buffer, 0, read)
              dataSize += read
            } else if (read == AudioRecord.ERROR_INVALID_OPERATION ||
              read == AudioRecord.ERROR_BAD_VALUE
            ) {
              break
            }
          }
        } catch (_: Exception) {
        } finally {
          try {
            out.close()
          } catch (_: Exception) {
          }
        }
      }
      recordThread?.start()

      promise.resolve(true)
    } catch (e: Exception) {
      recording = false
      promise.reject("RECORDER_ERROR", e.message ?: "start failed")
    }
  }

  override fun stopRecording(promise: Promise) {
    if (!recording) {
      promise.resolve(outputFile?.absolutePath ?: "")
      return
    }
    recording = false
    try {
      audioRecord?.stop()
      audioRecord?.release()
    } catch (_: Exception) {
    }
    audioRecord = null

    try {
      recordThread?.join(2000)
    } catch (_: Exception) {
    }
    recordThread = null

    val file = outputFile
    val totalData = dataSize
    outputFile = null
    dataSize = 0

    if (file == null) {
      promise.resolve("")
      return
    }
    try {
      writeWavHeader(file, chosenSampleRate, 1, 16, totalData)
    } catch (_: Exception) {
    }
    promise.resolve(file.absolutePath)
  }

  override fun isRecording(promise: Promise) {
    promise.resolve(recording)
  }

  private fun writeWavHeader(
    file: File,
    sampleRate: Int,
    channels: Int,
    bitsPerSample: Int,
    dataSize: Long,
  ) {
    val byteRate = sampleRate * channels * bitsPerSample / 8
    val blockAlign = channels * bitsPerSample / 8
    RandomAccessFile(file, "rw").use { raf ->
      raf.seek(0)
      val header = ByteArray(44)
      fun putAscii(offset: Int, s: String) {
        val b = s.toByteArray(Charsets.US_ASCII)
        System.arraycopy(b, 0, header, offset, b.size)
      }
      fun putIntLE(offset: Int, v: Long) {
        for (i in 0 until 4) {
          header[offset + i] = ((v shr (8 * i)) and 0xff).toByte()
        }
      }
      fun putShortLE(offset: Int, v: Int) {
        for (i in 0 until 2) {
          header[offset + i] = ((v shr (8 * i)) and 0xff).toByte()
        }
      }
      putAscii(0, "RIFF")
      putIntLE(4, 36 + dataSize)
      putAscii(8, "WAVE")
      putAscii(12, "fmt ")
      putIntLE(16, 16)
      putShortLE(20, 1) // PCM
      putShortLE(22, channels)
      putIntLE(24, sampleRate.toLong())
      putIntLE(28, byteRate.toLong())
      putShortLE(32, blockAlign)
      putShortLE(34, bitsPerSample)
      putAscii(36, "data")
      putIntLE(40, dataSize)
      raf.write(header)
    }
  }
}
