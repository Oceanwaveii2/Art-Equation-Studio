import type { LaunchLanguage } from './launchPreferences'
export const accelerationText: Record<LaunchLanguage, { label: string; standard: string; cuda: string; upload: string; jpeg: string; missing: string; retained: string; warming: string; ready: string; unavailable: string }> = {
  en: { label:'Native preparation acceleration',standard:'Standard · DX12 / Vulkan',cuda:'CUDA / DX12 shared resources',upload:'CUDA / DX12 + GPU upload heaps',jpeg:'nvJPEG is available for the JPEG comparison in Engine settings.',missing:'Optional NVIDIA libraries missing. Standard preparation remains available.',retained:'Standard paths retain buffers across jobs. Advanced paths are opt-in; no canvas speed claim.', warming:"Preparing selected acceleration in the background…", ready:"Selected preparation path is warm.", unavailable:"Advanced preparation unavailable; the standard fallback remains available." },
  'zh-CN': { label:'原生图像处理加速',standard:'标准 · DX12 / Vulkan',cuda:'CUDA / DX12 共享资源',upload:'CUDA / DX12 + GPU 上传堆',jpeg:'可在引擎设置中比较 nvJPEG 解码。',missing:'缺少可选 NVIDIA 库。标准处理仍可用。',retained:'标准路径在任务之间保留缓冲区。高级路径需手动启用；尚未验证画布速度提升。', warming:"正在后台准备所选加速路径…", ready:"所选处理路径已预热。", unavailable:"高级处理不可用；标准回退仍可用。" },
  ja: { label:'ネイティブ画像処理の高速化',standard:'標準 · DX12 / Vulkan',cuda:'CUDA / DX12 共有リソース',upload:'CUDA / DX12 + GPU アップロードヒープ',jpeg:'エンジン設定で nvJPEG デコードを比較できます。',missing:'オプションの NVIDIA ライブラリがありません。標準処理は利用可能です。',retained:'標準処理はバッファーを再利用します。高度な処理は手動選択です。キャンバスの高速化は未検証です。', warming:"選択した処理をバックグラウンドで準備中…", ready:"選択した処理の準備ができました。", unavailable:"高度な処理は利用できません。標準処理に切り替えられます。" },
  'pt-BR': { label:'Aceleração da preparação nativa',standard:'Padrão · DX12 / Vulkan',cuda:'Recursos compartilhados CUDA / DX12',upload:'CUDA / DX12 + heaps de upload da GPU',jpeg:'nvJPEG disponível para comparação nas configurações do mecanismo.',missing:'Bibliotecas NVIDIA opcionais ausentes. A preparação padrão continua disponível.',retained:'As opções padrão reutilizam buffers. Opções avançadas são manuais; sem alegação de ganho no canvas.', warming:"Preparando a aceleração em segundo plano…", ready:"A opção selecionada está pronta.", unavailable:"Preparação avançada indisponível; a alternativa padrão continua disponível." },
  'pt-PT': { label:'Aceleração da preparação nativa',standard:'Padrão · DX12 / Vulkan',cuda:'Recursos partilhados CUDA / DX12',upload:'CUDA / DX12 + heaps de upload da GPU',jpeg:'nvJPEG disponível para comparação nas definições do motor.',missing:'Bibliotecas NVIDIA opcionais em falta. A preparação padrão continua disponível.',retained:'As opções padrão reutilizam buffers. Opções avançadas são manuais; sem alegação de ganho no canvas.', warming:"A preparar a aceleração em segundo plano…", ready:"A opção selecionada está pronta.", unavailable:"Preparação avançada indisponível; a alternativa padrão continua disponível." },
  es: { label:'Aceleración de preparación nativa',standard:'Estándar · DX12 / Vulkan',cuda:'Recursos compartidos CUDA / DX12',upload:'CUDA / DX12 + heaps de carga de GPU',jpeg:'nvJPEG disponible para comparar en los ajustes del motor.',missing:'Faltan bibliotecas NVIDIA opcionales. La preparación estándar sigue disponible.',retained:'Las rutas estándar reutilizan buffers. Las avanzadas son opcionales; mejora del lienzo sin verificar.', warming:"Preparando la aceleración en segundo plano…", ready:"La ruta seleccionada está preparada.", unavailable:"Preparación avanzada no disponible; la alternativa estándar sigue disponible." },
}
const en = {
  starting: 'Starting Art Equation Studio', language: 'Launch language', hardware: 'Hardware check',
  checking: 'Checking graphics hardware…', browser: 'Browser preview · native hardware check requires the EXE.',
  backend: 'Native preparation backend', auto: 'Automatic (compatible hardware)',
  renderer: 'Canvas: browser WebGPU / Vello', scope: 'This preference controls native image-preparation experiments. Browser WebGPU selects its own viewport backend.',
  advanced: 'Advanced acceleration', pending: 'Integration pending · unavailable', amd: 'AMD-specific acceleration: unverified on AMD hardware.',
  ready: 'Workspace is ready.', preparing: 'Preparing your workspace…', finishing: 'Finishing workspace startup…', enter: 'Enter now',
  continue: 'Automatic entry paused while you adjust launch settings.', translation: 'Launch controls translated; workspace translation is not yet available.',
  fallback: 'Unsupported or failing native GPU paths fall back to Vulkan/DX12, then CPU.', failed: 'Hardware inspection unavailable. GPU capabilities have not been verified.',
  saveError: 'Launch preferences could not be saved to disk.', recommended: 'Recommended compatible native backend', adapters: 'Detected graphics adapters',
}
type Strings = typeof en
export const launchText: Record<LaunchLanguage, Strings> = {
  en,
  'zh-CN': {
    starting:'正在启动 Art Equation Studio',language:'启动界面语言',hardware:'硬件检查',checking:'正在检查图形硬件…',browser:'浏览器预览 · 原生硬件检查需要运行 EXE。',
    backend:'原生图像处理后端',auto:'自动（兼容硬件）',renderer:'画布：浏览器 WebGPU / Vello',scope:'此选项控制原生图像处理实验。浏览器 WebGPU 自行选择画布的图形后端。',
    advanced:'高级加速',pending:'尚未集成 · 不可用',amd:'AMD 专用加速：尚未在 AMD 硬件上验证。',ready:'工作区已就绪。',preparing:'正在准备工作区…',finishing:'正在完成启动…',enter:'立即进入',
    continue:'调整启动设置时，自动进入已暂停。',translation:'启动控件已翻译；工作区翻译尚未提供。',fallback:'不受支持或失败的原生 GPU 路径会回退至 Vulkan/DX12，然后回退至 CPU。',
    failed:'硬件检查不可用。GPU 功能尚未验证。',saveError:'无法将启动设置保存到磁盘。',recommended:'推荐的兼容原生后端',adapters:'检测到的显卡',
  },
  ja: {
    starting:'Art Equation Studio を起動中',language:'起動画面の言語',hardware:'ハードウェア確認',checking:'グラフィックスハードウェアを確認中…',browser:'ブラウザープレビュー · ネイティブのハードウェア確認には EXE が必要です。',
    backend:'ネイティブ画像処理バックエンド',auto:'自動（互換性のあるハードウェア）',renderer:'キャンバス：ブラウザー WebGPU / Vello',scope:'この設定はネイティブ画像処理の実験に適用されます。ブラウザー WebGPU は独自にキャンバスのバックエンドを選択します。',
    advanced:'高度なアクセラレーション',pending:'未実装 · 利用不可',amd:'AMD 専用アクセラレーション：AMD ハードウェアでは未検証です。',ready:'ワークスペースの準備ができました。',preparing:'ワークスペースを準備中…',finishing:'起動処理を完了中…',enter:'開く',
    continue:'起動設定の変更中は自動開始を一時停止します。',translation:'起動コントロールは翻訳済みです。ワークスペースの翻訳は未対応です。',fallback:'非対応または失敗したネイティブ GPU 処理は Vulkan/DX12、次に CPU に切り替わります。',
    failed:'ハードウェア確認を利用できません。GPU 機能は未確認です。',saveError:'起動設定をディスクに保存できませんでした。',recommended:'推奨される互換ネイティブバックエンド',adapters:'検出されたグラフィックスアダプター',
  },
  'pt-BR': {
    starting:'Iniciando Art Equation Studio',language:'Idioma da tela inicial',hardware:'Verificação de hardware',checking:'Verificando o hardware gráfico…',browser:'Prévia no navegador · a verificação nativa requer o EXE.',
    backend:'Backend nativo de preparação',auto:'Automático (hardware compatível)',renderer:'Tela: WebGPU do navegador / Vello',scope:'Esta preferência controla os testes de preparação nativa de imagens. O WebGPU do navegador escolhe seu próprio backend gráfico.',
    advanced:'Aceleração avançada',pending:'Integração pendente · indisponível',amd:'Aceleração específica da AMD: não verificada em hardware AMD.',ready:'Área de trabalho pronta.',preparing:'Preparando sua área de trabalho…',finishing:'Concluindo a inicialização…',enter:'Entrar agora',
    continue:'Entrada automática pausada enquanto você ajusta as configurações.',translation:'Controles iniciais traduzidos; a tradução da área de trabalho ainda não está disponível.',fallback:'Se uma opção nativa falhar ou não for compatível, o sistema usa Vulkan/DX12 e depois CPU.',
    failed:'Verificação de hardware indisponível. Recursos da GPU não verificados.',saveError:'Não foi possível salvar as preferências no disco.',recommended:'Backend nativo compatível recomendado',adapters:'Adaptadores gráficos detectados',
  },
  'pt-PT': {
    starting:'A iniciar o Art Equation Studio',language:'Idioma do ecrã inicial',hardware:'Verificação de hardware',checking:'A verificar o hardware gráfico…',browser:'Pré-visualização no navegador · a verificação nativa requer o EXE.',
    backend:'Backend nativo de preparação',auto:'Automático (hardware compatível)',renderer:'Tela: WebGPU do navegador / Vello',scope:'Esta preferência controla os testes de preparação nativa de imagens. O WebGPU do navegador escolhe o seu próprio backend gráfico.',
    advanced:'Aceleração avançada',pending:'Integração pendente · indisponível',amd:'Aceleração específica da AMD: não verificada em hardware AMD.',ready:'Área de trabalho pronta.',preparing:'A preparar a área de trabalho…',finishing:'A concluir o arranque…',enter:'Entrar agora',
    continue:'Entrada automática suspensa enquanto ajusta as definições.',translation:'Controlos iniciais traduzidos; a tradução da área de trabalho ainda não está disponível.',fallback:'Se uma opção nativa falhar ou não for compatível, o sistema utiliza Vulkan/DX12 e depois CPU.',
    failed:'Verificação de hardware indisponível. Funcionalidades da GPU não verificadas.',saveError:'Não foi possível guardar as preferências no disco.',recommended:'Backend nativo compatível recomendado',adapters:'Adaptadores gráficos detetados',
  },
  es: {
    starting:'Iniciando Art Equation Studio',language:'Idioma de inicio',hardware:'Comprobación de hardware',checking:'Comprobando el hardware gráfico…',browser:'Vista previa en el navegador · la comprobación nativa requiere el EXE.',
    backend:'Backend nativo de preparación',auto:'Automático (hardware compatible)',renderer:'Lienzo: WebGPU del navegador / Vello',scope:'Esta preferencia controla las pruebas de preparación nativa de imágenes. WebGPU elige su propio backend para el lienzo.',
    advanced:'Aceleración avanzada',pending:'Integración pendiente · no disponible',amd:'Aceleración específica de AMD: sin verificar en hardware AMD.',ready:'Espacio de trabajo listo.',preparing:'Preparando el espacio de trabajo…',finishing:'Finalizando el inicio…',enter:'Entrar ahora',
    continue:'Entrada automática pausada mientras ajustas la configuración.',translation:'Controles de inicio traducidos; la traducción del espacio de trabajo aún no está disponible.',fallback:'Si una opción nativa falla o no es compatible, se usa Vulkan/DX12 y después CPU.',
    failed:'Comprobación de hardware no disponible. Capacidades de GPU sin verificar.',saveError:'No se pudieron guardar las preferencias en disco.',recommended:'Backend nativo compatible recomendado',adapters:'Adaptadores gráficos detectados',
  },
}
