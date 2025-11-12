import frappe
import json

def on_task_save(doc, method):
    """
    Send Telegram notification when a task is assigned to a user
    """
    # Only proceed if this is not a new document
    if doc.is_new():
        return
        
    try:
        # Get the document before save to compare
        old_doc = doc.get_doc_before_save()
        if not old_doc:
            return
            
        # Get old and new assignment values
        old_assign = getattr(old_doc, '_assign', '[]')
        new_assign = getattr(doc, '_assign', '[]')
        
        # If assignment didn't change, return
        if old_assign == new_assign:
            return
            
        # Parse assigned users from new assignment
        if new_assign:
            assigned_users = json.loads(new_assign)
            
            for user_email in assigned_users:
                # Get user's Telegram ID from custom field
                telegram_id = frappe.db.get_value('User', user_email, 'telegram_user_id')
                
                if telegram_id:
                    send_telegram_notification(telegram_id, doc)
                    
    except Exception as e:
        frappe.log_error(f"Telegram notification error: {str(e)}", "Task Assignment Notification Error")

def send_telegram_notification(telegram_id, task_doc):
    """Send notification to Telegram"""
    bot_token = "8473617616:AAEkJqGLj0Io6DM2mJmKw_X5hv3WJrjc6hs"
    
    # Get allocated by user (owner or modified_by)
    allocated_by = task_doc.owner or task_doc.modified_by or 'System'
    
    message = f"""*New Notification Arrived!* 🔔

*Notification Details:*
• Allocated by: {allocated_by}
• Reference Type: Task
• Description: {task_doc.subject or 'No description'}

_Tibeb Design & Build ERP_
"""
    
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        'chat_id': telegram_id,
        'text': message,
        'parse_mode': 'Markdown'
    }
    
    try:
        response = frappe.make_post_request(url, data=payload, timeout=10)
        if response.get('ok') is not True:
            frappe.log_error(f"Telegram API error: {response.get('description')}", "Telegram API Error")
    except Exception as e:
        frappe.log_error(f"Telegram request failed: {str(e)}", "Telegram Notification Error")
