#!/usr/bin/env python3
import sys
import json
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
from reportlab.lib.enums import TA_CENTER

def generate_session_pdf(session_data, output_path):
    doc = SimpleDocTemplate(output_path, pagesize=A4,
        rightMargin=2*cm, leftMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle('Title', parent=styles['Title'],
        fontSize=22, textColor=colors.HexColor('#d4af37'),
        spaceAfter=6, fontName='Helvetica-Bold', alignment=TA_CENTER)
    subtitle_style = ParagraphStyle('Subtitle', parent=styles['Normal'],
        fontSize=12, textColor=colors.HexColor('#9896a8'), spaceAfter=20, alignment=TA_CENTER)
    section_style = ParagraphStyle('Section', parent=styles['Heading2'],
        fontSize=14, textColor=colors.HexColor('#d4af37'),
        spaceBefore=16, spaceAfter=8, fontName='Helvetica-Bold')
    body_style = ParagraphStyle('Body', parent=styles['Normal'],
        fontSize=10, textColor=colors.HexColor('#2d2b3d'), spaceAfter=8, leading=16)
    meta_style = ParagraphStyle('Meta', parent=styles['Normal'],
        fontSize=9, textColor=colors.HexColor('#6b7280'), spaceAfter=4)

    story = []
    story.append(Paragraph(f"Session {session_data.get('number', '')} — {session_data.get('title', 'Sans titre')}", title_style))

    meta_parts = []
    if session_data.get('date'): meta_parts.append(session_data['date'])
    if session_data.get('campaign_title'): meta_parts.append(f"Campagne : {session_data['campaign_title']}")
    if meta_parts: story.append(Paragraph(' · '.join(meta_parts), subtitle_style))

    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#d4af37'), spaceAfter=16))

    if session_data.get('summary'):
        story.append(Paragraph("Resume", section_style))
        for line in session_data['summary'].split('\n'):
            if line.strip(): story.append(Paragraph(line.strip(), body_style))

    if session_data.get('narrative'):
        story.append(Paragraph("Journal narratif", section_style))
        for line in session_data['narrative'].split('\n'):
            if line.strip(): story.append(Paragraph(line.strip(), body_style))

    if session_data.get('raw_notes'):
        story.append(Paragraph("Notes de session", section_style))
        for line in session_data['raw_notes'].split('\n'):
            if line.strip(): story.append(Paragraph(line.strip(), body_style))

    if session_data.get('transcript'):
        story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor('#e5e7eb'), spaceAfter=12))
        story.append(Paragraph("Transcription", section_style))
        for line in session_data['transcript'].split('\n'):
            if line.strip(): story.append(Paragraph(line.strip(), body_style))

    if session_data.get('notes'):
        story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor('#e5e7eb'), spaceAfter=12))
        story.append(Paragraph("Notes partagees", section_style))
        for note in session_data['notes']:
            story.append(Paragraph(f"{note.get('username','?')} - {note.get('title','')}", meta_style))
            story.append(Paragraph(note.get('content',''), body_style))

    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor('#e5e7eb'), spaceAfter=8))
    story.append(Paragraph("Genere par VaultLog", ParagraphStyle('Footer',
        parent=styles['Normal'], fontSize=8, textColor=colors.HexColor('#9896a8'), alignment=TA_CENTER)))

    doc.build(story)

if __name__ == '__main__':
    data = json.loads(sys.stdin.read())
    generate_session_pdf(data['session'], data['output'])
