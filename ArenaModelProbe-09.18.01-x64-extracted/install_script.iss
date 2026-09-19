; Created by "innounp" version 2.67.11
; Setup file: Arena模型探测工具-09.18.01-x64.exe
; Inno Setup Version: 6.7.0 (Unicode)

[Setup]
AppName=Arena模型探测工具-稳定版
AppId=ArenaCompanion.ModelProbe.Desktop
AppVersion=09.18.01
DefaultDirName={localappdata}\Programs\ArenaModelCompanion
OutputBaseFilename=Arena模型探测工具-09.18.01-x64
UninstallDisplayIcon={app}\Arena筛选助手.exe
Compression=lzma2
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
PrivilegesRequired=lowest
DisableDirPage=auto
DisableProgramGroupPage=auto
ChangesAssociations=no
ShowLanguageDialog=yes
WizardStyle=modern light
WizardImageFile=embedded\WizardImage0.png
WizardSmallImageFile=embedded\WizardSmallImage0.png

[Files]
Source: "{app}\Arena筛选助手.exe"; DestDir: "{app}"; 
Source: "{app}\Arena筛选助手.exe.config"; DestDir: "{app}"; 
Source: "{app}\Microsoft.Web.WebView2.Core.dll"; DestDir: "{app}"; 
Source: "{app}\Microsoft.Web.WebView2.WinForms.dll"; DestDir: "{app}"; 
Source: "{app}\WebView2Loader.dll"; DestDir: "{app}"; 
Source: "{app}\assets\arena-model-probe.ico"; DestDir: "{app}\assets"; 
Source: "{app}\assets\arena-model-probe.inject.js"; DestDir: "{app}\assets"; 
Source: "{app}\assets\arena-model-probe.png"; DestDir: "{app}\assets"; 
Source: "{app}\assets\ArenaBalance.js"; DestDir: "{app}\assets"; 
Source: "{app}\assets\AuthBridge.js"; DestDir: "{app}\assets"; 
Source: "{app}\assets\CandidateBridge.js"; DestDir: "{app}\assets"; 
Source: "{app}\assets\ConversationMarkdown.js"; DestDir: "{app}\assets"; 
Source: "{app}\assets\ConversationRecovery.js"; DestDir: "{app}\assets"; 
Source: "{app}\assets\demo.html"; DestDir: "{app}\assets"; 
Source: "{app}\assets\FollowLatest.js"; DestDir: "{app}\assets"; 
Source: "{app}\assets\gallery.html"; DestDir: "{app}\assets"; 
Source: "{app}\assets\PageBridge.js"; DestDir: "{app}\assets"; 
Source: "{app}\assets\WebView2-LICENSE.txt"; DestDir: "{app}\assets"; 
Source: "{app}\assets\WebView2-NOTICE.txt"; DestDir: "{app}\assets"; 
Source: "{app}\assets\welcome.html"; DestDir: "{app}\assets"; 
Source: "{tmp}\webview2-offline-x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall dontcopy 
Source: "{tmp}\ndp48-x86-x64-allos-enu.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall dontcopy 

[Run]
Filename: "{app}\Arena筛选助手.exe"; Description: "启动 Arena模型探测工具-稳定版"; Flags: postinstall unchecked skipifsilent nowait

[Icons]
Name: "{userprograms}\Arena模型探测工具-稳定版"; Filename: "{app}\Arena筛选助手.exe"; 
Name: "{userdesktop}\Arena模型探测工具-稳定版"; Filename: "{app}\Arena筛选助手.exe"; Tasks: desktopicon; 

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; 

[CustomMessages]
zhcn.NameAndVersion=%1 version %2
zhcn.AdditionalIcons=Additional shortcuts:
zhcn.CreateDesktopIcon=Create a &desktop shortcut
zhcn.CreateQuickLaunchIcon=Create a &Quick Launch shortcut
zhcn.ProgramOnTheWeb=%1 on the Web
zhcn.UninstallProgram=Uninstall %1
zhcn.LaunchProgram=Launch %1
zhcn.AssocFileExtension=&Associate %1 with the %2 file extension
zhcn.AssocingFileExtension=Associating %1 with the %2 file extension...
zhcn.AutoStartProgramGroupDescription=Startup:
zhcn.AutoStartProgram=Automatically start %1
zhcn.AddonHostProgramNotFound=%1 could not be located in the folder you selected.%n%nDo you want to continue anyway?

[Languages]
; These files are stubs
; To achieve better results after recompilation, use the real language files
Name: "zhcn"; MessagesFile: "embedded\zhcn.isl"; 
