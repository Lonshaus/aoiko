## Default Permission

バックアップフォルダの選択と解決、その配下のファイル入出力、iOS/iPadOS の印刷と
アプリ内ブラウザ表示に必要な権限。どのフォルダを起点にするかはプラグイン側だけが決め、
受け取ったパスはその配下に収まることを検査してから使う。

#### This default permission set includes the following:

- `allow-pick-folder`
- `allow-resolve-folder`
- `allow-print-page`
- `allow-open-in-app`
- `allow-confirm-discard`
- `allow-backup-open`
- `allow-backup-write-chunk`
- `allow-backup-close`
- `allow-backup-read`
- `allow-backup-list`
- `allow-backup-remove`
- `allow-export-open`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`aoiko-native:allow-backup-close`

</td>
<td>

Enables the backup_close command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:deny-backup-close`

</td>
<td>

Denies the backup_close command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:allow-backup-list`

</td>
<td>

Enables the backup_list command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:deny-backup-list`

</td>
<td>

Denies the backup_list command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:allow-backup-open`

</td>
<td>

Enables the backup_open command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:deny-backup-open`

</td>
<td>

Denies the backup_open command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:allow-backup-read`

</td>
<td>

Enables the backup_read command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:deny-backup-read`

</td>
<td>

Denies the backup_read command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:allow-backup-remove`

</td>
<td>

Enables the backup_remove command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:deny-backup-remove`

</td>
<td>

Denies the backup_remove command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:allow-backup-write-chunk`

</td>
<td>

Enables the backup_write_chunk command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:deny-backup-write-chunk`

</td>
<td>

Denies the backup_write_chunk command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:allow-confirm-discard`

</td>
<td>

Enables the confirm_discard command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:deny-confirm-discard`

</td>
<td>

Denies the confirm_discard command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:allow-export-open`

</td>
<td>

Enables the export_open command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:deny-export-open`

</td>
<td>

Denies the export_open command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:allow-open-in-app`

</td>
<td>

Enables the open_in_app command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:deny-open-in-app`

</td>
<td>

Denies the open_in_app command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:allow-pick-folder`

</td>
<td>

Enables the pick_folder command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:deny-pick-folder`

</td>
<td>

Denies the pick_folder command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:allow-print-page`

</td>
<td>

Enables the print_page command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:deny-print-page`

</td>
<td>

Denies the print_page command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:allow-resolve-folder`

</td>
<td>

Enables the resolve_folder command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aoiko-native:deny-resolve-folder`

</td>
<td>

Denies the resolve_folder command without any pre-configured scope.

</td>
</tr>
</table>
