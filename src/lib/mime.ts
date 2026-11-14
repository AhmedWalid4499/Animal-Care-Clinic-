// File type from a file name, for attachments picked from disk.
export function mimeOf(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', txt: 'text/plain', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dcm: 'application/dicom' } as Record<string, string>)[ext] ?? 'application/octet-stream';
}
