; setup_script.iss
#include "version.iss"
#define MyAppName "TLI Tracker"
#define MyAppPublisher "nyk"
#define MyAppExeName "main.exe"

[Setup]
AppId={{BE922103-61C0-405B-A1AB-75D3B597215E}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}

; INSTALL TO LOCAL APPDATA
DefaultDirName={localappdata}\{#MyAppName}
PrivilegesRequired=lowest

DisableProgramGroupPage=yes
OutputDir=..\installer
OutputBaseFilename=TLITracker_Setup
SetupIconFile=..\ui\assets\logo.ico
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\dist\main.dist\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; \
    Excludes: "\data\sessions, \data\config.json, \data\prices.json, \data\sessions.json"

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
