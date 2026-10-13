"""The welcome email with login details, sent on account creation and admin resets."""

from app import config
from app.email import send_email

TEMP_PASSWORD_HOURS = 72


def send_welcome(conn, user: dict, temp_password: str) -> bool:
    body = (
        f"Hello {user['first_name']},\n\n"
        "An account has been set up for you on Citi Overwatch.\n\n"
        f"Username: {user['username']}\n"
        f"Temporary password: {temp_password}\n\n"
        f"Sign in here: {config.app_url()}/login\n\n"
        f"The temporary password expires in {TEMP_PASSWORD_HOURS} hours. "
        "You'll be asked to choose a new password the first time you sign in.\n"
    )
    return send_email(user["email"], "Your Citi Overwatch account", body)
