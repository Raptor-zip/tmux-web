import { closeInstallHelp, useInstallState } from '../pwa';
import { Modal } from './Modal';

/** ブラウザが追加ダイアログを出せないときの手順。『表示と接続』・パレット・初回の案内から開く */
export function InstallHelp() {
  const install = useInstallState();
  if (!install.help) return null;
  return <Modal title="アプリとして使う" onClose={closeInstallHelp}>
    <div className="install-help">
      <p>専用ウィンドウで開き、アプリ一覧やDockから起動できます。</p>
      <p>UbuntuのChrome・Braveでは、ブラウザ右上のメニューにある「インストール」または「ページをアプリとしてインストール」を選んでください。項目はブラウザによって異なります。</p>
      <p>起動後にDockのアイコンを右クリックし、「お気に入りに追加」で固定できます。</p>
      <p>iPhone・iPadではSafariの共有メニューから「ホーム画面に追加」を選んでください。</p>
      {install.error && <p className="inline-error" role="alert">{install.error}</p>}
      <p className="field-hint">Tailscaleに接続した状態で使えます。タブとワークスペースの配置は、このブラウザと同じ保存先を使います。</p>
    </div>
  </Modal>;
}
