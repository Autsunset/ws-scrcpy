# 飞牛与 Redroid：并行部署 ws-scrcpy

Compose 接入已有 Redroid，不重建它，也不占现有 WebScreen 的 `8079`。镜像内运行独立的 ADB server，ADB 密钥保存在卷中；只有 Web 服务发布到宿主机，而且默认只监听回环地址。

## 配置与启动

1. 在飞牛 Docker 界面确认 Redroid 容器的名称及所在的**用户自定义网络**。本服务需要在该网络上通过容器名或网络别名访问 Redroid 的 ADB 端口。若 Redroid 不在用户自定义网络上，可另外创建一个共享网络并把现有容器接进去，不必重建。不要为此向宿主机或公网新增 ADB 端口映射。
2. 从仓库根目录执行下列命令生成访问密码。镜像里的用户 UID 是 `1000`，须能读取挂载的密码文件；如果宿主机的当前用户不是 UID `1000`，让管理员把文件所有者设为 `1000`，不要把文件设成全局可读。

   ```sh
   install -d -m 700 .secrets
   (umask 077; set -C; openssl rand -hex 32 > .secrets/admin-password)
   ```

3. 创建 `.env`，把前两项替换为实际网络名和 Redroid 的 ADB 地址：

   ```dotenv
   REDROID_NETWORK=redroid_default
   REDROID_ADB_TARGET=redroid:5555
   WS_SCRCPY_HTTP_PORT=8080
   WS_SCRCPY_AUTH_ORIGIN=http://localhost:8080
   ```

4. 在飞牛上运行 `docker compose up -d --build`，用 `docker compose ps` 查看服务状态。若从另一台电脑测试，通过 SSH 隧道访问：

   ```sh
   ssh -N -L 8080:127.0.0.1:8080 <nas-user>@192.168.101.100
   ```

   浏览器打开 `http://localhost:8080`，用生成的密码登录。检查设备列表、首帧、触控，以及重启 `ws-scrcpy` 后能否恢复。`docker compose exec ws-scrcpy adb devices -l` 用于区分 ADB 未连通、未授权与浏览器串流问题。若设备要求授权，只在设备侧确认自己发起的 ADB 请求。

### 通过局域网 HTTPS 访问

如果飞牛不允许 SSH 端口转发，可以直接使用局域网 HTTPS。将 `.env` 中的绑定 IP 设为飞牛的局域网 IP，不要设为 `0.0.0.0`，并让登录 origin 与浏览器地址一致：

```dotenv
WS_SCRCPY_BIND_IP=192.168.101.100
WS_SCRCPY_HTTP_PORT=18079
WS_SCRCPY_AUTH_ORIGIN=https://192.168.101.100:18079
```

在项目目录生成仅用于该 IP 的证书（或使用你已有的可信证书；本地健康检查要求证书也包含 `127.0.0.1`）：

```sh
test ! -e .secrets/tls.key && test ! -e .secrets/tls.crt &&
  (umask 077; openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
    -nodes -days 365 -subj '/CN=192.168.101.100' \
    -addext 'subjectAltName=IP:192.168.101.100,IP:127.0.0.1' \
    -addext 'basicConstraints=critical,CA:FALSE' \
    -keyout .secrets/tls.key -out .secrets/tls.crt)
docker compose -f compose.yaml -f compose.tls.yaml up -d --build
```

在自己的客户端信任通过可信渠道取得的 `tls.crt`，不要复制 `tls.key` 或忽略不匹配的证书。自签证书未建立浏览器信任时，WebCodecs 可能不可用。不做路由器端口转发；需要公网时使用下文的 HTTPS 反代方案。

### 安装为手机应用与全屏

- 使用证书受信的 HTTPS 地址。若 Android 不接受自签服务器证书，使用可信域名证书，或用自己的局域网 CA 签发服务器证书。服务器的 `tls.crt` 可包含服务器证书与 CA 的 PEM 证书链，手机只导入公开 CA 证书，不要传 CA 或服务器私钥。只在自己管理的设备上信任这个 CA。
- Android 用 Chrome 打开并登录，选 **安装应用**。iPhone / iPad 用 Safari 的 **分享 → 添加到主屏幕**，如有「作为网页 App 打开」则开启。安装后从图标打开，不显示普通浏览器地址栏。应用需要能连到飞牛，不提供离线投屏，也不会缓存登录页、投屏数据或密码。
- 投屏工具栏的 **全屏** 会隐藏侧栏或底栏；系统允许时进入原生全屏，并尝试按视频方向旋转。浏览器不开放全屏时会铺满网页内容，但不能强制隐藏系统状态栏。超宽手机与 `16:9` 串流比例不同时保留黑边，不拉伸、不裁掉画面。

## 调整码率

在设备的 **投屏设置** 或串流中的 **画质与帧率** 选择预设，或输入 `0.1` 至 `64` Mbps。该值是编码器的**目标**码率，不代表设备会实际达到。Redroid 编码器可能限制或拒绝部分分辨率、帧率及码率组合。建议先用 `8–12` Mbps 测试，再逐档提高，观察画面、延迟和 NAS CPU；出现黑屏或卡顿就调低码率，不要同时改帧率和分辨率。

也可以拖动码率滑块。点击 **应用并保存** 或 **保存并打开** 会记住下一次连接时请求的码率、帧率和其他画质设置。设置保存在当前浏览器，普通窗口和小窗共用；不同播放器和屏幕各自保存。编码器的实际输出可能与请求值不同。

设备列表中 **保存** 只记录配置，下次点 **打开手机** 才应用；**保存并打开** 立即用这些配置连接。投屏内的 **画质与帧率** 会显示设备回报的分辨率、目标码率和帧率，以及浏览器实收码率。比如设备仍回报 `1280 × 720` 时，提高码率不会增加像素。Chrome、Via 等浏览器不会共用画质缓存，需要分别保存。

设备列表的 **悬浮窗** 在支持 Document Picture-in-Picture 的浏览器里打开置顶小窗，否则打开普通小窗。置顶小窗内按 `F8` 收起，回到设备列表后再按 `F8` 恢复；普通小窗内按 `F8` 遮住或恢复画面。网页不能在其它应用里接收全局热键。

设备列表的 **打开手机** 默认使用固定编码尺寸，最长边 `1280`、`30 FPS`、`8 Mbps`；浏览器调整尺寸时不会重新编码，除非启用 **跟随窗口编码尺寸**。触屏竖屏时工具栏在底部，横屏时保留在侧边。会优先使用浏览器支持的 MSE 或 WebCodecs，再回退到软件解码，不按 UA 名称决定。WebCodecs 的统计面板显示当前解码队列和恢复次数。

### 和 WebScreen 对比

用同一个 Redroid、浏览器、分辨率、帧率和目标码率，两边轮流跑同一段场景，避免两个客户端同时改变编码参数。记录点击打开到首帧、触控到画面反馈、掉帧和断线恢复；用 `docker stats` 对比各服务和 Redroid 的 CPU。ws-scrcpy 的 **Show quality stats** 可以辅助查看浏览器端接收、解码和掉帧数据。首轮用 MSE，之后再用同一设置对比 WebCodecs。

MSE 的 **Buffered ahead** 是浏览器已缓冲但尚未播放的时长，不是点击到画面反馈的端到端延迟。播放器在积压时会短暂加速；积压较大或画面停住时，会跳到缓冲区末尾附近，优先显示最近画面。

## 看连接状态与故障恢复

- 设备页区分网页服务、ADB 连接与 scrcpy 进程。Compose 的 `/healthz` 继续只检查网页服务。登录后可查看 `/readyz`：投屏进程就绪时返回 `200`；ADB 不可用、设备未连接或投屏进程未启动时返回 `503` 和对应状态。投屏进程就绪后，仍要等浏览器呈现首帧才能确认画面可用。
- 投屏断开、连接后 12 秒仍未呈现首帧，或播放器报告错误时，会在当前窗口重新连接，保留这次的画质设置。重试间隔逐步增加，最长 30 秒。可以立即重试、暂停自动重连，或在会话失效后重新登录再重试。
- **画质与帧率** 分别显示请求设置、设备回报和浏览器实收码率，并记录最近一次连接到首帧的耗时和本次打开后的重连次数。

## 从外网访问

- 个人使用优先走私有网络。若用公网域名，在飞牛上通过 HTTPS 反代回环地址 `127.0.0.1:8080`，确保支持 WebSocket Upgrade，且不改写浏览器的 `Origin`。将 `WS_SCRCPY_AUTH_ORIGIN` 改成浏览器使用的精确地址（例如 `https://phone.example.com`，不带末尾斜杠），并重建服务容器。
- 需要同时使用多个 HTTPS 地址时，可保留 `WS_SCRCPY_AUTH_ORIGIN`，并通过 `WS_SCRCPY_AUTH_EXTRA_ORIGINS` 指定其他精确来源，多个来源以英文逗号分隔，例如 `https://phone.example.com,https://phone2.example.com`。反向代理应保留浏览器请求的 `Host` 和 `Origin`；每个来源使用独立的登录会话。
- HTTP 和 WebSocket 共用登录会话。默认有效期为 8 小时，服务重启即失效。仅在自己的设备上勾选 **在此设备保持登录 14 天**：浏览器保存登录凭证而非密码，重新打开同一地址或服务重建后仍然有效（须保留 `auth-sessions` 卷）。主动退出会撤销凭证并断开串流；修改访问密码并重启也会使旧凭证失效。
- 公网 origin 只接受 HTTPS，Cookie 带 `Secure`、`HttpOnly` 和 `SameSite=Strict`。应用的失败冷却是全局的，公网反代仍应加独立的访问限制或身份验证。
- Docker 版关闭浏览器 ADB Shell、DevTools 和手机直连串流；认证模式也关闭任意目标的 WebSocket 代理。不要单独对外映射 ADB 或 scrcpy 端口。不带 Docker 的旧启动方式仍可不配置登录，**不能直接暴露**。

需要回退时运行 `docker compose down`（不加 `-v`），原 `8079` 服务和 Redroid 数据不会被替换。
