// gen/android は生成物で git に入っていない。tauri android init はランチャーアイコンを
// 既定のロゴで置き、こちらから差し替える口も無い（CLI は出力先を
// gen/android/app/src/main/res/ に固定していて、出所ディレクトリという概念が無い）。
// prepare-ios.mjs と同じ形で、icons/android を出所として毎回上書きし直す。
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';

const src = new URL('../src-tauri/icons/android/', import.meta.url).pathname;
const dest = new URL('../src-tauri/gen/android/app/src/main/res/', import.meta.url).pathname;
const gradleFile = new URL('../src-tauri/gen/android/app/build.gradle.kts', import.meta.url)
  .pathname;

// まだ init していない作業コピーでは置き先が無い。ここで落とすと android:dev /
// android:build が本来の「先に init しろ」という案内へ進めなくなるので黙って通す。
if (!existsSync(dest)) {
  console.log('gen/android がまだ無いので何もしない');
  process.exit(0);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const files = walk(src);
if (files.length === 0) {
  console.error(`${src} に何も無い`);
  process.exit(1);
}

// 前景 PNG は自適応アイコンの安全域（中央 72/108）へ収めてある。tauri icon はそれを
// 考えずに敷き詰めるので、あちらを回すとランチャーの遮罩で猫の下端が切れる。
for (const file of files) {
  const rel = relative(src, file);
  const to = join(dest, rel);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(file, to);
}

// 署名設定は Tauri の公式手順が生成物 build.gradle.kts の直接編集を指示しており、置き場所が
// gen/ の中しか無い。消えると戻らないのでここから足す。範本の中身には触れず末尾へ追記する
// だけにして、Tauri が範本を変えても壊れないようにしてある。
const MARKER = '// aoiko: 署名設定';
const SIGNING_BLOCK = `${MARKER}。gen/ は生成物なので prepare-android.mjs が毎回ここへ足す。
// 鍵は repo 外の ~/.playconsole、パスワードは macOS のキーチェーンから取る。
val aoikoKeystore = file("\${System.getProperty("user.home")}/.playconsole/aoiko-upload.jks")
    .takeIf { it.exists() }

fun aoikoKeychain(account: String): String? = try {
    val p = ProcessBuilder(
        "security", "find-generic-password", "-s", "aoiko-upload", "-a", account, "-w"
    ).start()
    val out = p.inputStream.bufferedReader().readText().trim()
    if (p.waitFor() == 0 && out.isNotEmpty()) out else null
} catch (e: Exception) {
    null
}

android {
    signingConfigs {
        create("aoiko-release") {
            if (aoikoKeystore != null) {
                storeFile = aoikoKeystore
                storePassword = aoikoKeychain("store")
                keyAlias = "upload"
                keyPassword = aoikoKeychain("key")
            }
        }
    }
    buildTypes {
        getByName("release") {
            if (aoikoKeystore != null) {
                signingConfig = signingConfigs.getByName("aoiko-release")
            }
        }
    }
}
`;
if (!existsSync(gradleFile)) {
  console.error(`${gradleFile} が無い。gen/android が壊れている`);
  process.exit(1);
}
const gradle = readFileSync(gradleFile, 'utf8');
let signing = '追記済み';
if (!gradle.includes(MARKER)) {
  writeFileSync(gradleFile, `${gradle.replace(/\n*$/, '\n')}\n${SIGNING_BLOCK}`);
  signing = '追記した';
}
console.log(`アイコン ${files.length} 件を同期した。署名設定は${signing}`);
