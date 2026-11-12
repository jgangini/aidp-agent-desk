from .schemas import ConnectionStatus


def connection_status(configured: bool = False) -> ConnectionStatus:
    return ConnectionStatus(
        publication_configured=configured,
        message=(
            "Configuración guardada. Falta verificar publicación, transporte y contrato del agente antes de conectar."
            if configured
            else "AIDP pendiente de publicación. El simulador funciona sin credenciales ni llamadas externas."
        ),
    )
