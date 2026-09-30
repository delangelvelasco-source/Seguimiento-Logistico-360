# Controles de seguridad — Seguimiento Logístico 360°

## Alcance

Este documento registra controles técnicos implementados en la aplicación y sirve como evidencia de cambio controlado. No constituye una certificación de cumplimiento de Expeditors.

## Controles implementados

- Autenticación mediante Supabase Auth.
- RLS en las tablas operativas configuradas para acceso por sesión.
- Identificación de usuarios por cuenta individual.
- Gafetes aislados del flujo operativo y del monitor.
- Funciones sensibles de Caseta con autorización de sesión y rol.
- Acceso anónimo retirado de superficies operativas sensibles.
- Contador de folios no expuesto al API directo.
- Realtime privado por almacén para Caseta.
- Bloqueo de sesión por inactividad a los 15 minutos, con aviso a los 13 minutos.
- Historial de cambios mediante GitHub y despliegue automatizado.
- CI con auditoría de dependencias y compilación de producción.

## Pendientes organizacionales / de infraestructura

- MFA para cuentas privilegiadas.
- Retención formal de logs de seguridad por al menos 12 meses.
- Escaneo de vulnerabilidades de infraestructura y aplicación.
- Política formal de retención y eliminación de datos.
- Plan y pruebas documentadas de continuidad y recuperación.
- Procedimiento formal de respuesta a incidentes.
- Capacitación anual de seguridad y privacidad.
- Revisión formal de controles por Seguridad/IT de la empresa.

## Criterio

Los requisitos publicados por Expeditors para proveedores son una referencia de alineación técnica. La aceptación definitiva debe ser validada por el área de Seguridad/IT correspondiente.
